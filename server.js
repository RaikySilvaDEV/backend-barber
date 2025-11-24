// server.js
import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import { v4 as uuidv4 } from "uuid";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());

// ⚠️ Mantém RAW BODY (não atrapalha, mas não será usado)
app.use(
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf.toString();
    },
  })
);

// ⚙️ Configurações
const ACCESS_TOKEN =
  process.env.MP_ACCESS_TOKEN ||
  "APP_USR-6959164002929941-110913-153611435420a9e65813ee0dec906991-1359156098";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE;

// 🔥 Função auxiliar — Atualiza tabela de vendas no Supabase
async function updateSupabasePaymentStatus(saleId, status) {
  console.log("🔄 Atualizando Supabase...", saleId, status);

  try {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/sales?id=eq.${saleId}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          apikey: SUPABASE_SERVICE_ROLE,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE}`,
          Prefer: "return=representation",
        },
        body: JSON.stringify({ payment_status: status }),
      }
    );

    const resData = await response.text();
    console.log("📡 Resposta Supabase:", resData);
  } catch (error) {
    console.error("❌ Erro ao atualizar Supabase:", error);
  }
}

// =========================================================
// 🟢 CRIAÇÃO DO PIX (CORRIGIDO)
// =========================================================
app.post("/api/pix", async (req, res) => {
  try {
    const { total, descricao, sale_id } = req.body;

    const payload = {
      transaction_amount: Number(total),
      description: descricao || `Pagamento venda #${sale_id}`,
      payment_method_id: "pix",
      external_reference: `SALE_${sale_id}`, // 🔥 Vem de volta no webhook
      notification_url: "https://backend-barber.up.railway.app/api/webhook",
      payer: { email: "cliente@exemplo.com" },
    };

    const idemKey = uuidv4();
    console.log("📦 Criando PIX:", idemKey, payload);

    const response = await fetch("https://api.mercadopago.com/v1/payments", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        "Content-Type": "application/json",
        "X-Idempotency-Key": idemKey,
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    console.log("🔍 Resposta Mercado Pago:", data);

    if (!response.ok) return res.status(400).json(data);

    const pix = data.point_of_interaction.transaction_data;

    res.json({
      qrCode: pix.qr_code_base64,
      copiaECola: pix.qr_code,
      id: data.id,
      sale_id,
    });
  } catch (err) {
    console.error("🔥 Erro no servidor PIX:", err);
    res.status(500).json({ error: "Erro interno no servidor PIX" });
  }
});

// =========================================================
// 🟣 WEBHOOK CORRIGIDO (SEM ASSINATURA!)
// Mercado Pago PIX NÃO envia x-signature.
// =========================================================
app.post("/webhook", async (req, res) => {
  try {
    console.log("📩 WEBHOOK RECEBIDO:", req.body);

    const paymentId = req.body?.data?.id;

    if (!paymentId) {
      console.log("❌ Payment ID inválido");
      return res.sendStatus(400);
    }

    // 🔎 Consultar detalhes do pagamento
    const det = await fetch(
      `https://api.mercadopago.com/v1/payments/${paymentId}`,
      { headers: { Authorization: `Bearer ${ACCESS_TOKEN}` } }
    );

    const payment = await det.json();
    console.log("💰 Detalhes do pagamento:", payment);

    if (payment.status === "approved") {
      const saleId = payment.external_reference.replace("SALE_", "");
      console.log("🎉 Pagamento aprovado para venda:", saleId);

      await updateSupabasePaymentStatus(saleId, "paid");
    } else {
      console.log("ℹ️ Pagamento ainda não aprovado:", payment.status);
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("❌ Erro no webhook:", err);
    res.sendStatus(500);
  }
});

// =========================================================
// 🧭 Health Check
// =========================================================
app.get("/", (req, res) => {
  res.send("🚀 Servidor PIX + Webhook ativo!");
});

// =========================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`🚀 Servidor rodando em http://localhost:${PORT}`)
);
// =========================================================
