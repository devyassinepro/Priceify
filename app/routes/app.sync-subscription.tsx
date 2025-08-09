import { json, LoaderFunctionArgs, redirect } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { updateSubscription, getOrCreateSubscription } from "../models/subscription.server";
import { PLANS } from "../lib/plans";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  
  console.log(`🔄 Synchronizing subscription for ${session.shop}...`);
  
  try {
    // Récupérer les abonnements actifs depuis Shopify
    const response = await admin.graphql(`
      query GetAppSubscriptions {
        app {
          installation {
            activeSubscriptions {
              id
              name
              status
              currentPeriodEnd
              test
              lineItems {
                plan {
                  pricingDetails {
                    ... on AppRecurringPricing {
                      price {
                        amount
                        currencyCode
                      }
                      interval
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
    console.log(`📊 Shopify subscriptions response:`, JSON.stringify(data, null, 2));
    
    const activeSubscriptions = data.data?.app?.installation?.activeSubscriptions || [];
    const localSubscription = await getOrCreateSubscription(session.shop);
    
    if (activeSubscriptions.length === 0) {
      // Aucun abonnement actif - rester sur le plan gratuit
      console.log(`ℹ️ No active subscriptions found, keeping free plan`);
      return redirect("/app?sync=no_subscription");
    }
    
    // Prendre le premier abonnement actif
    const subscription = activeSubscriptions[0];
    const amount = subscription.lineItems?.[0]?.plan?.pricingDetails?.price?.amount;
    const subscriptionId = subscription.id.split('/').pop();
    
    console.log(`💰 Found subscription: ${subscription.status}, Amount: ${amount}`);
    
    if (subscription.status !== "ACTIVE") {
      console.log(`⚠️ Subscription not active: ${subscription.status}`);
      return redirect("/app?sync=inactive_subscription");
    }
    
    // Déterminer le plan basé sur le prix
    let planName = "free";
    if (amount) {
      const priceFloat = parseFloat(amount);
      console.log(`🔍 Matching price: ${priceFloat}`);
      
      // Correspondance des prix avec une tolérance
      for (const [key, plan] of Object.entries(PLANS)) {
        if (Math.abs(plan.price - priceFloat) < 0.02) {
          planName = key;
          console.log(`✅ Matched plan: ${planName} for price $${priceFloat}`);
          break;
        }
      }
      
      // Correspondance par plage si aucune correspondance exacte
      if (planName === "free" && priceFloat > 0) {
        if (priceFloat >= 4.50 && priceFloat <= 5.50) {
          planName = "standard";
        } else if (priceFloat >= 9.50 && priceFloat <= 10.50) {
          planName = "pro";
        }
        console.log(`🔄 Fallback plan assignment: ${planName}`);
      }
    }
    
    // Vérifier si une mise à jour est nécessaire
    const needsUpdate = localSubscription.planName !== planName || 
                       localSubscription.status !== "active" ||
                       localSubscription.subscriptionId !== subscriptionId;
    
    if (needsUpdate) {
      console.log(`🔄 Updating local subscription: ${localSubscription.planName} → ${planName}`);
      
      await updateSubscription(session.shop, {
        planName,
        status: "active",
        subscriptionId,
        usageLimit: PLANS[planName].usageLimit,
        currentPeriodEnd: subscription.currentPeriodEnd ? new Date(subscription.currentPeriodEnd) : undefined,
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
  // Cette page ne devrait jamais s'afficher grâce aux redirections
  return (
    <div style={{ padding: "2rem", textAlign: "center" }}>
      <h1>Synchronizing subscription...</h1>
      <p>Please wait while we update your subscription details.</p>
    </div>
  );
}