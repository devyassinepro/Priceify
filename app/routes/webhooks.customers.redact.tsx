import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { db } from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    // ✅ FIX: Use authenticate.webhook for HMAC verification (REQUIRED)
    const { shop, payload, topic } = await authenticate.webhook(request);
    
    console.log(`🗑️ Customer redact request for shop: ${shop}`, payload);
    
    // GDPR compliance: Delete/anonymize customer data
    const customerId = payload.customer?.id;
    const customerEmail = payload.customer?.email;
    
    if (customerId || customerEmail) {
      // Delete all data associated with this customer
      const deleteResult = await db.pricingHistory.deleteMany({
        where: {
          shop,
          OR: [
            { userEmail: customerEmail },
            // Add other customer identifiers if you store them
          ]
        }
      });
      
      console.log(`🗑️ Deleted ${deleteResult.count} records for customer ${customerEmail || customerId}`);
      console.log(`✅ Customer data redaction completed for ${shop}`);
    }
    
    return new Response(null, { status: 200 });
  } catch (error) {
    console.error("❌ Customer redact webhook error:", error);
    return new Response("Webhook processing failed", { status: 500 });
  }
};