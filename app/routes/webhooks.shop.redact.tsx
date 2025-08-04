import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { db } from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    // ✅ FIX: Use authenticate.webhook for HMAC verification (REQUIRED)
    const { shop, payload, topic } = await authenticate.webhook(request);
    
    console.log(`🏪 Shop redact request for: ${shop}`);
    
    // GDPR compliance: Delete ALL shop data (48 hours after uninstall)
    const deleteOperations = await Promise.all([
      db.pricingHistory.deleteMany({ where: { shop } }),
      db.subscription.deleteMany({ where: { shop } }),
      // Add any other tables that store shop data
    ]);
    
    const totalDeleted = deleteOperations.reduce((sum, result) => sum + result.count, 0);
    
    console.log(`🗑️ Deleted ${totalDeleted} total records for shop ${shop}`);
    console.log(`✅ Shop data redaction completed for ${shop}`);
    
    return new Response(null, { status: 200 });
  } catch (error) {
    console.error("❌ Shop redact webhook error:", error);
    return new Response("Webhook processing failed", { status: 500 });
  }
};