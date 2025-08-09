import { LoaderFunctionArgs, redirect } from "@remix-run/node";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  
  // Pour les Managed Pricing Apps, rediriger directement vers Shopify
  const shopName = session.shop.replace('.myshopify.com', '');
  const shopifyPricingUrl = `https://admin.shopify.com/store/${shopName}/charges/priceboost/pricing_plans`;
  
  console.log(`🔄 Redirecting to Shopify pricing: ${shopifyPricingUrl}`);
  
  return redirect(shopifyPricingUrl);
};

export default function Billing() {
  // Cette page ne devrait jamais s'afficher grâce au redirect
  return (
    <div style={{ padding: "2rem", textAlign: "center" }}>
      <h1>Redirecting to pricing plans...</h1>
      <p>Please wait while we redirect you to Shopify's pricing page.</p>
    </div>
  );
}