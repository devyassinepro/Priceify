import { LoaderFunctionArgs, redirect } from "@remix-run/node";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  
  // Extract shop name and redirect directly to pricing plans
  const shopName = session.shop.replace('.myshopify.com', '');
  return redirect(`https://admin.shopify.com/store/${shopName}/charges/priceboost/pricing_plans`);
};

export default function Billing() {
  // This should never render due to redirect
  return <div>Redirecting to pricing plans...</div>;
}