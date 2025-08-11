import { json, LoaderFunctionArgs, redirect } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { updateSubscription, getOrCreateSubscription } from "../models/subscription.server";
import { PLANS } from "../lib/plans";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  
  console.log(`🔄 Synchronizing subscription for ${session.shop}...`);
  
  try {
    // ✅ REQUÊTE SIMPLE pour récupérer les abonnements actifs
    const response = await admin.graphql(`
      query GetAppSubscriptions {
        app {
          installation {
            activeSubscriptions {
              id
              name
              status
              currentPeriodEnd
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
    console.log(`📊 Shopify subscriptions:`, JSON.stringify(data.data, null, 2));
    
    const activeSubscriptions = data.data?.app?.installation?.activeSubscriptions || [];
    const localSubscription = await getOrCreateSubscription(session.shop);
    
    if (activeSubscriptions.length === 0) {
      // ✅ Aucun abonnement actif = plan gratuit
      console.log(`ℹ️ No active subscriptions found, ensuring free plan`);
      
      if (localSubscription.planName !== "free") {
        await updateSubscription(session.shop, {
          planName: "free",
          status: "active",
          usageLimit: PLANS.free.usageLimit
        });
        
        return redirect("/app?sync=success&plan=free&message=Reset to free plan");
      }
      
      return redirect("/app?sync=no_subscription");
    }
    
    // ✅ Prendre le premier abonnement actif
    const subscription = activeSubscriptions[0];
    const amount = subscription.lineItems?.[0]?.plan?.pricingDetails?.price?.amount;
    const subscriptionId = subscription.id.split('/').pop();
    
    console.log(`💰 Found subscription: ${subscription.status}, Amount: ${amount}`);
    
    if (subscription.status !== "ACTIVE") {
      console.log(`⚠️ Subscription not active: ${subscription.status}`);
      return redirect("/app?sync=inactive_subscription");
    }
    
    // ✅ DÉTERMINER LE PLAN basé sur le prix
    let planName = "free";
    if (amount) {
      const priceFloat = parseFloat(amount);
      console.log(`🔍 Matching price: ${priceFloat}`);
      
      // Correspondance exacte avec tolérance
      for (const [key, plan] of Object.entries(PLANS)) {
        if (Math.abs(plan.price - priceFloat) < 0.02) {
          planName = key;
          console.log(`✅ Matched plan: ${planName} for price $${priceFloat}`);
          break;
        }
      }
      
      // Correspondance par fourchette si pas d'exacte correspondance
      if (planName === "free" && priceFloat > 0) {
        if (priceFloat >= 4.50 && priceFloat <= 5.50) {
          planName = "standard";
        } else if (priceFloat >= 9.50 && priceFloat <= 10.50) {
          planName = "pro";
        }
        console.log(`🔄 Fallback plan assignment: ${planName}`);
      }
    }
    
    // ✅ MISE À JOUR si nécessaire
    const needsUpdate = localSubscription.planName !== planName || 
                       localSubscription.status !== "active" ||
                       localSubscription.subscriptionId !== subscriptionId;
    
    if (needsUpdate) {
      console.log(`🔄 Updating subscription: ${localSubscription.planName} → ${planName}`);
      
      await updateSubscription(session.shop, {
        planName,
        status: "active",
        subscriptionId,
        usageLimit: PLANS[planName].usageLimit,
        currentPeriodEnd: subscription.currentPeriodEnd ? 
          new Date(subscription.currentPeriodEnd) : 
          new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });
      
      console.log(`✅ Subscription synchronized successfully!`);
      return redirect(`/app?sync=success&plan=${planName}`);
    } else {
      console.log(`ℹ️ Subscription already up to date`);
      return redirect("/app?sync=already_synced");
    }
    
  } catch (error: any) {
    console.error(`❌ Subscription sync failed:`, error);
    return redirect(`/app?sync=error&message=${encodeURIComponent(error.message)}`);
  }
};

export default function SyncSubscription() {
  // ✅ Cette page ne devrait jamais s'afficher grâce aux redirections
  return (
    <div style={{ 
      padding: "2rem", 
      textAlign: "center",
      fontFamily: "system-ui, sans-serif" 
    }}>
      <h1>🔄 Synchronizing subscription...</h1>
      <p>Please wait while we update your subscription details.</p>
      <div style={{ marginTop: "2rem" }}>
        <div style={{
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