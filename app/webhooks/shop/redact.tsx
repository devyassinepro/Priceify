import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../../shopify.server";
import { db } from "../../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop } = await authenticate.webhook(request);
  
  console.log(`Shop redact request for: ${shop}`);
  
  // Supprimer TOUTES les données de la boutique
  await db.pricingHistory.deleteMany({ where: { shop } });
  await db.subscription.deleteMany({ where: { shop } });
  
  return new Response();
};