import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../../shopify.server";
import { db } from "../../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload } = await authenticate.webhook(request);
  
  console.log(`Customer redact request for shop: ${shop}`, payload);
  
  // Supprimer/anonymiser les données du customer
  const customerId = payload.customer?.id;
  if (customerId) {
    await db.pricingHistory.deleteMany({
      where: {
        shop,
        userEmail: payload.customer?.email
      }
    });
  }
  
  return new Response();
};