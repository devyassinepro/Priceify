import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { db } from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    // ✅ FIX: Use authenticate.webhook for HMAC verification (REQUIRED)
    const { shop, payload, topic } = await authenticate.webhook(request);
    
    console.log(`📧 Customer data request for shop: ${shop}`, payload);
    
    // GDPR compliance: Collect and send customer data
    const customerId = payload.customer?.id;
    const customerEmail = payload.customer?.email;
    
    if (customerId && customerEmail) {
      // Get all data for this customer from your database
      const customerData = await db.pricingHistory.findMany({
        where: {
          shop,
          userEmail: customerEmail
        }
      });
      
      // Format the data according to GDPR requirements
      const gdprData = {
        customer_id: customerId,
        email: customerEmail,
        pricing_history: customerData.map(record => ({
          date: record.createdAt.toISOString(),
          product_title: record.productTitle,
          old_price: record.oldPrice,
          new_price: record.newPrice,
          action_type: record.actionType
        }))
      };
      
      console.log(`📊 Prepared GDPR data export for customer ${customerEmail}`);
      
      // In production, you would email this data to the customer
      // For now, just log that we processed the request
      console.log(`✅ GDPR data request processed for ${customerEmail}`);
    }
    
    return new Response(null, { status: 200 });
  } catch (error) {
    console.error("❌ GDPR data request webhook error:", error);
    return new Response("Webhook processing failed", { status: 500 });
  }
};