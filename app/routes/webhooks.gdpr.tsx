import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { db } from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    // ✅ Utiliser authenticate.webhook pour la vérification HMAC (OBLIGATOIRE)
    const { shop, payload, topic } = await authenticate.webhook(request);
    
    console.log(`📧 Received GDPR webhook: ${topic} for shop: ${shop}`);
    
    switch (topic) {
      case "customers/data_request":
        console.log(`📊 Customer data request for shop: ${shop}`, payload);
        
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
        break;
        
      case "customers/redact":
        console.log(`🗑️ Customer redact request for shop: ${shop}`, payload);
        
        // GDPR compliance: Delete/anonymize customer data
        const redactCustomerId = payload.customer?.id;
        const redactCustomerEmail = payload.customer?.email;
        
        if (redactCustomerId || redactCustomerEmail) {
          // Delete all data associated with this customer
          const deleteResult = await db.pricingHistory.deleteMany({
            where: {
              shop,
              OR: [
                { userEmail: redactCustomerEmail },
                // Add other customer identifiers if you store them
              ]
            }
          });
          
          console.log(`🗑️ Deleted ${deleteResult.count} records for customer ${redactCustomerEmail || redactCustomerId}`);
          console.log(`✅ Customer data redaction completed for ${shop}`);
        }
        break;
        
      case "shop/redact":
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
        break;
        
      default:
        console.warn(`❌ Unhandled GDPR webhook topic: ${topic}`);
        return new Response("Unhandled webhook topic", { status: 400 });
    }
    
    return new Response(null, { status: 200 });
  } catch (error) {
    console.error("❌ GDPR webhook error:", error);
    return new Response("Webhook processing failed", { status: 500 });
  }
};