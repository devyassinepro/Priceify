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
  
  try {
    // ✅ MÉTHODE 1: Essayer l'authentification normale d'abord
    let admin, session;
    
    try {
      const authResult = await authenticate.admin(request);
      admin = authResult.admin;
      session = authResult.session;
      console.log(`✅ Authentication successful for ${session.shop}`);
    } catch (authError) {
      console.log(`⚠️ Admin auth failed, trying alternative method:`, authError);
      
      // ✅ MÉTHODE 2: Authentification alternative pour callback
      // Construire une URL de redirection vers l'app avec les paramètres
      const appUrl = `/app?callback=billing&shop=${shop}&plan=${planParam || 'unknown'}`;
      console.log(`🔄 Redirecting to app with callback params: ${appUrl}`);
      return redirect(appUrl);
    }
    
    // ✅ Si l'authentification a réussi, continuer avec la logique normale
    if (session.shop !== shop) {
      console.error(`❌ Shop mismatch: session=${session.shop}, callback=${shop}`);
      return redirect(`/auth/login?shop=${shop}`);
    }
    
    // Récupérer les abonnements actifs depuis Shopify
    const response = await admin.graphql(`
      query GetActiveSubscriptions {
        app {
          installation {
            activeSubscriptions {
              id
              name
              status
              currentPeriodEnd
              createdAt
              lineItems {
                plan {
                  pricingDetails {
                    ... on AppRecurringPricing {
                      price {
                        amount
                        currencyCode
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    `);

    const data = await response.json();
    const activeSubscriptions = data.data?.app?.installation?.activeSubscriptions || [];
    
    console.log(`📊 Found ${activeSubscriptions.length} active subscriptions`);
    
    if (activeSubscriptions.length === 0) {
      console.error(`❌ No active subscriptions found after callback`);
      return redirect("/app?error=no_subscription_found");
    }
    
    // Prendre l'abonnement le plus récent
    const latestSubscription = activeSubscriptions.sort((a: any, b: any) => 
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )[0];
    
    if (latestSubscription.status !== "ACTIVE") {
      console.log(`⚠️ Subscription status: ${latestSubscription.status}`);
      return redirect("/app?error=subscription_not_active");
    }
    
    const amount = latestSubscription.lineItems?.[0]?.plan?.pricingDetails?.price?.amount;
    const subscriptionId = latestSubscription.id.split('/').pop();
    
    console.log(`💰 Processing subscription: ${subscriptionId}, amount: ${amount}`);
    
    // Déterminer le plan basé sur le prix
    let planName = planParam || "free";
    if (amount) {
      const priceFloat = parseFloat(amount);
      for (const [key, plan] of Object.entries(PLANS)) {
        if (Math.abs(plan.price - priceFloat) < 0.02) {
          planName = key;
          console.log(`✅ Matched plan: ${planName} for price $${priceFloat}`);
          break;
        }
      }
    }
    
    // Mettre à jour l'abonnement local
    await updateSubscription(session.shop, {
      planName,
      status: "active",
      subscriptionId,
      usageLimit: PLANS[planName].usageLimit,
      currentPeriodEnd: latestSubscription.currentPeriodEnd ? 
        new Date(latestSubscription.currentPeriodEnd) : 
        new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });
    
    console.log(`✅ Subscription updated successfully: ${planName}`);
    
    // ✅ REDIRECTION SÉCURISÉE vers l'app avec paramètres de succès
    return redirect(`/app?sync=success&plan=${planName}&upgraded=true`);
    
  } catch (error: any) {
    console.error(`💥 Billing callback error:`, error);
    return redirect(`/app?error=callback_failed&message=${encodeURIComponent(error.message)}`);
  }
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