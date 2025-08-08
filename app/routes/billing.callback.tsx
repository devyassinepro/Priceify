import { redirect } from "@remix-run/node";
import type { LoaderFunctionArgs } from "@remix-run/node";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  console.log(`🔄 Legacy billing callback hit: ${url.toString()}`);
  
  // Redirect to the correct app route with all parameters
  const redirectUrl = `/app/billing/callback${url.search}`;
  console.log(`↪️ Redirecting to: ${redirectUrl}`);
  
  return redirect(redirectUrl);
};

export default function LegacyBillingCallback() {
  return (
    <div style={{ padding: "2rem", textAlign: "center" }}>
      <h1>Redirecting...</h1>
      <p>Please wait while we process your payment.</p>
    </div>
  );
}