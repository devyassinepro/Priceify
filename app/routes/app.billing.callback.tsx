import { json, LoaderFunctionArgs, redirect } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { updateSubscription } from "../models/subscription.server";
import { PLANS } from "../lib/plans";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");
  const planParam = url.searchParams.get("plan");
  
  console.log(`🔄 Billing callback received for shop: ${shop}, plan: ${planParam}`);
  console.log(`🔗 Full callback URL: ${url.toString()}`);
  
  // ✅ Vérifier les paramètres requis
  if (!shop) {
    console.error(`❌ No shop parameter in callback URL`);
    return redirect("/auth/login?error=missing_shop");
  }
  
  // ✅ FIX: Rediriger vers l'admin Shopify avec les paramètres de billing
  const shopName = shop.replace('.myshopify.com', '');
  const adminUrl = `https://admin.shopify.com/store/${shopName}/apps/pricefy-1?billing_success=1&plan=${planParam || 'unknown'}`;
  
  console.log(`🔄 Redirecting to Shopify admin: ${adminUrl}`);
  
  // Redirection JavaScript pour changer le top-level window
  return new Response(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Redirecting...</title>
      <meta charset="utf-8">
    </head>
    <body>
      <div style="text-align: center; padding: 2rem; font-family: system-ui;">
        <h1>🔄 Processing your subscription...</h1>
        <p>Redirecting you back to Shopify...</p>
        <div class="spinner" style="border: 4px solid #f3f3f3; border-top: 4px solid #3498db; border-radius: 50%; width: 40px; height: 40px; animation: spin 2s linear infinite; margin: 0 auto;"></div>
      </div>
      <style>
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      </style>
      <script>
        // Rediriger le top-level window vers l'admin Shopify
        window.top.location.href = "${adminUrl}";
      </script>
    </body>
    </html>
  `, {
    headers: {
      'Content-Type': 'text/html',
    },
  });
};

export default function BillingCallback() {
  return (
    <div style={{ 
      padding: "2rem", 
      textAlign: "center",
      fontFamily: "system-ui, sans-serif"
    }}>
      <h1>🔄 Processing your subscription...</h1>
      <p>Please wait while we activate your new plan.</p>
      <div style={{ marginTop: "2rem" }}>
        <div className="spinner" style={{
          border: "4px solid #f3f3f3",
          borderTop: "4px solid #3498db",
          borderRadius: "50%",
          width: "40px",
          height: "40px",
          animation: "spin 2s linear infinite",
          margin: "0 auto"
        }}></div>
      </div>
      <style>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}