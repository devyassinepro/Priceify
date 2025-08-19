// app/routes/billing-return.tsx - Solution avec sessionStorage
import { LoaderFunctionArgs, redirect } from "@remix-run/node";
import { updateSubscription } from "../models/subscription.server";
import { PLANS } from "../lib/plans";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    const url = new URL(request.url);
    const chargeId = url.searchParams.get("charge_id");
    const shop = url.searchParams.get("shop");

    console.log(`🔄 Processing billing return`);
    console.log(`💳 Charge ID: ${chargeId}`);
    console.log(`🏪 Shop: ${shop}`);

    if (!chargeId || !shop) {
      console.log("❌ Missing charge ID or shop, redirecting to app");
      return redirect("/app?billing_error=missing_params");
    }

    // ✅ SOLUTION: Créer une page HTML qui stocke les données en sessionStorage puis redirige
    const host = Buffer.from(`${shop}/admin`).toString('base64');
    
    const html = `
<!DOCTYPE html>
<html>
<head>
    <title>Processing Payment...</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            margin: 0;
            background: #f6f6f7;
        }
        .container {
            text-align: center;
            background: white;
            padding: 2rem;
            border-radius: 8px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        }
        .spinner {
            border: 3px solid #f3f3f3;
            border-top: 3px solid #008060;
            border-radius: 50%;
            width: 40px;
            height: 40px;
            animation: spin 1s linear infinite;
            margin: 0 auto 1rem;
        }
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="spinner"></div>
        <h2>🎉 Payment Successful!</h2>
        <p>Processing your subscription upgrade...</p>
        <p><small>You'll be redirected to your app in a moment.</small></p>
    </div>
    
    <script>
        console.log('🔄 Storing billing data in sessionStorage...');
        
        // Stocker les données de billing dans sessionStorage
        const billingData = {
            billing_completed: '1',
            charge_id: '${chargeId}',
            needs_manual_sync: '1',
            shop: '${shop}',
            timestamp: Date.now()
        };
        
        sessionStorage.setItem('billing_return_data', JSON.stringify(billingData));
        
        console.log('✅ Billing data stored:', billingData);
        
        // Rediriger vers l'app après un petit délai
        setTimeout(() => {
            console.log('🔗 Redirecting to app...');
            // Utiliser window.top pour sortir de l'iframe si nécessaire
            const appUrl = '/app?host=${host}&shop=${shop}&billing_return=1';
            if (window.top) {
                window.top.location.href = appUrl;
            } else {
                window.location.href = appUrl;
            }
        }, 2000);
    </script>
</body>
</html>`;

    return new Response(html, {
      headers: {
        "Content-Type": "text/html",
      },
    });

  } catch (error: any) {
    console.error("💥 Error processing billing return:", error);
    return redirect("/app?billing_error=unknown");
  }
};