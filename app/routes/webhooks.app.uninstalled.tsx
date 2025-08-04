import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { db } from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    // ✅ FIX: Use authenticate.webhook for HMAC verification (REQUIRED)
    const { shop, session, topic } = await authenticate.webhook(request);

    console.log(`📱 Received ${topic} webhook for ${shop}`);

    // Clean up session data immediately
    if (session) {
      await db.session.deleteMany({ where: { shop } });
      console.log(`🗑️ Deleted session data for ${shop}`);
    }
    
    // Note: Don't delete all data here - Shopify will send SHOP_REDACT webhook 
    // 48 hours later for GDPR compliance
    
    return new Response(null, { status: 200 });
  } catch (error) {
    console.error("❌ App uninstall webhook error:", error);
    return new Response("Webhook processing failed", { status: 500 });
  }
};