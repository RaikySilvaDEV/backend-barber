// server.js
import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import { v4 as uuidv4 } from "uuid";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// ⚙️ Configurações
const ACCESS_TOKEN =
  process.env.MP_ACCESS_TOKEN ||
  "APP_USR-6959164002929941-110913-153611435420a9e65813ee0dec906991-1359156098";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE;

// 🔥 Função auxiliar: Atualiza status no Supabase
async function updateSupabasePaymentStatus(saleId, status) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE) {
    console.warn("⚠️ Variáveis do Supabase não configuradas no .env");
    return;
  }

  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/sales?id=eq.${saleId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_SERVICE_ROLE,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE}`,
       "Prefer": "return=representation" // ✅ recomendado para ver resposta
      },
      body: JSON.stringify({ payment_status: status }),
    });

    if (response.ok) {
      console.log(`✅ Venda ${saleId} atualizada para ${status} no Supabase`);
    } else {
      const err = await response.text();
      console.error("❌ Erro ao atualizar Supabase:", err);
    }
  } catch (error) {
    console.error("❌ Erro no updateSupabasePaymentStatus:", error);
  }
}

// =========================================================
// 🟢 CRIAÇÃO DO PAGAMENTO PIX (mantido e funcional)
// =========================================================
app.post("/api/pix", async (req, res) => {
  try {
    const { total, descricao, sale_id } = req.body;

    if (!total || isNaN(total)) {
      return res.status(400).json({ error: "Valor inválido para total" });
    }

    const payload = {
      transaction_amount: Number(total),
      description: descricao || `Pagamento venda #${sale_id}`,
      payment_method_id: "pix",
      payer: { email: "cliente@exemplo.com" },
    };

    const idemKey = uuidv4();
    console.log("📦 Criando PIX com X-Idempotency-Key:", idemKey);

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

    if (!response.ok) {
      console.error("❌ Erro Mercado Pago:", data);
      return res.status(response.status).json(data);
    }

    const pix = data.point_of_interaction.transaction_data;

    res.json({
      qrCode: pix.qr_code_base64,
      copiaECola: pix.qr_code,
      id: data.id,
      status: data.status,
      sale_id,
    });
  } catch (err) {
    console.error("🔥 Erro no servidor PIX:", err);
    res.status(500).json({ error: "Erro interno no servidor PIX" });
  }
});

// =========================================================
// 🟣 WEBHOOK DO MERCADO PAGO → Verificação Automática
// =========================================================
app.post("/api/webhook", async (req, res) => {
  try {
    console.log("📩 Webhook recebido:", req.body);

    const paymentId = req.body?.data?.id;
    if (!paymentId) {
      return res.status(400).json({ error: "ID de pagamento não encontrado" });
    }

    // 🔎 Busca detalhes do pagamento
    const paymentResponse = await fetch(
      `https://api.mercadopago.com/v1/payments/${paymentId}`,
      {
        headers: {
          Authorization: `Bearer ${ACCESS_TOKEN}`,
        },
      }
    );

    const payment = await paymentResponse.json();
    console.log("💰 Detalhes do pagamento:", payment);

    // ✅ Pagamento aprovado
    if (payment.status === "approved") {
      console.log(`✅ Pagamento aprovado! ID: ${payment.id}`);

      // Extrai o número da venda do campo "description"
      const saleMatch = payment.description.match(/#(\d+)/);
      const saleId = saleMatch ? saleMatch[1] : null;

      if (saleId) {
        await updateSupabasePaymentStatus(saleId, "paid");
      } else {
        console.warn("⚠️ Não foi possível identificar o sale_id na descrição.");
      }
    } else {
      console.log(`⏳ Status atual: ${payment.status}`);
    }

    res.sendStatus(200);
  } catch (error) {
    console.error("❌ Erro ao processar webhook:", error);
    res.status(500).json({ error: "Erro ao processar webhook" });
  }
});

// =========================================================
// 🧭 Health Check
// =========================================================
app.get("/", (req, res) => {
  res.send("🚀 Servidor PIX + Webhook ativo e funcional!");
});

// =========================================================
app.listen(3000, () => {
  console.log("🚀 Servidor rodando em http://localhost:3000");
});
