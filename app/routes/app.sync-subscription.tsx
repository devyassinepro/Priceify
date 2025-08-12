import { json, LoaderFunctionArgs, redirect } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { updateSubscription, getOrCreateSubscription } from "../models/subscription.server";
import { PLANS } from "../lib/plans";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  
  const url = new URL(request.url);
  console.log(`🔄 === SYNC SUBSCRIPTION STARTED ===`);
  console.log(`🏪 Shop: ${session.shop}`);
  console.log(`🔗 Sync URL: ${url.toString()}`);
  
  try {
    // ✅ REQUÊTE pour récupérer les abonnements actifs
    console.log(`📡 Querying Shopify for active subscriptions...`);
    const response = await admin.graphql(`
      query GetAppSubscriptions {
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
    console.log(`📊 Shopify GraphQL response:`);
    console.log(JSON.stringify(data.data, null, 2));
    
    const activeSubscriptions = data.data?.app?.installation?.activeSubscriptions || [];
    const localSubscription = await getOrCreateSubscription(session.shop);
    
    console.log(`💾 Local subscription before sync:`);
    console.log(`- Plan: ${localSubscription.planName}`);
    console.log(`- Status: ${localSubscription.status}`);
    console.log(`- Usage: ${localSubscription.usageCount}/${localSubscription.usageLimit}`);
    console.log(`- Subscription ID: ${localSubscription.subscriptionId}`);
    
    if (activeSubscriptions.length === 0) {
      // ✅ Aucun abonnement actif = plan gratuit
      console.log(`ℹ️ No active subscriptions found in Shopify`);
      
      if (localSubscription.planName !== "free") {
        console.log(`🔄 Resetting to free plan (was: ${localSubscription.planName})`);
        await updateSubscription(session.shop, {
          planName: "free",
          status: "active",
          usageLimit: PLANS.free.usageLimit,
          subscriptionId: undefined, // ✅ Fix: undefined instead of null
        });
        
        console.log(`✅ Successfully reset to free plan`);
        return redirect("/app?sync=success&plan=free&message=Reset%20to%20free%20plan");
      }
      
      console.log(`ℹ️ Already on free plan, no sync needed`);
      return redirect("/app?sync=no_subscription");
    }
    
    // ✅ Traiter l'abonnement actif
    const subscription = activeSubscriptions[0];
    const amount = subscription.lineItems?.[0]?.plan?.pricingDetails?.price?.amount;
    const subscriptionId = subscription.id.split('/').pop();
    
    console.log(`💰 Processing active subscription:`);
    console.log(`- ID: ${subscriptionId}`);
    console.log(`- Status: ${subscription.status}`);
    console.log(`- Amount: ${amount} ${subscription.lineItems?.[0]?.plan?.pricingDetails?.price?.currencyCode || 'USD'}`);
    console.log(`- Name: ${subscription.name}`);
    console.log(`- Period End: ${subscription.currentPeriodEnd}`);
    
    if (subscription.status !== "ACTIVE") {
      console.log(`⚠️ Subscription status is not ACTIVE: ${subscription.status}`);
      return redirect("/app?sync=inactive_subscription");
    }
    
    // ✅ DÉTERMINER LE PLAN basé sur le prix
    let planName = "free";
    if (amount) {
      const priceFloat = parseFloat(amount);
      console.log(`🔍 Matching price: ${priceFloat}`);
      
      // Correspondance exacte avec tolérance
      for (const [key, plan] of Object.entries(PLANS)) {
        console.log(`   Checking ${key}: ${plan.price} (difference: ${Math.abs(plan.price - priceFloat)})`);
        if (Math.abs(plan.price - priceFloat) < 0.02) {
          planName = key;
          console.log(`✅ Exact match found: ${planName} for price ${priceFloat}`);
          break;
        }
      }
      
      // Correspondance par fourchette si pas d'exacte correspondance
      if (planName === "free" && priceFloat > 0) {
        if (priceFloat >= 4.50 && priceFloat <= 5.50) {
          planName = "standard";
          console.log(`🔄 Fallback match: standard plan for price ${priceFloat}`);
        } else if (priceFloat >= 9.50 && priceFloat <= 10.50) {
          planName = "pro";
          console.log(`🔄 Fallback match: pro plan for price ${priceFloat}`);
        } else {
          console.log(`⚠️ No plan match found for price ${priceFloat}, keeping free`);
        }
      }
    } else {
      console.log(`⚠️ No amount found in subscription, keeping free plan`);
    }
    
    // ✅ MISE À JOUR si nécessaire
    const needsUpdate = localSubscription.planName !== planName || 
                       localSubscription.status !== "active" ||
                       localSubscription.subscriptionId !== subscriptionId;
    
    console.log(`🔍 Sync analysis:`);
    console.log(`- Current plan: ${localSubscription.planName}`);
    console.log(`- Expected plan: ${planName}`);
    console.log(`- Current status: ${localSubscription.status}`);
    console.log(`- Expected status: active`);
    console.log(`- Current subscription ID: ${localSubscription.subscriptionId}`);
    console.log(`- Expected subscription ID: ${subscriptionId}`);
    console.log(`- Needs update: ${needsUpdate}`);
    
    if (needsUpdate) {
      console.log(`🔄 Updating subscription: ${localSubscription.planName} → ${planName}`);
      
      const updateData = {
        planName,
        status: "active",
        subscriptionId,
        usageLimit: PLANS[planName].usageLimit,
        currentPeriodEnd: subscription.currentPeriodEnd ? 
          new Date(subscription.currentPeriodEnd) : 
          new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      };
      
      console.log(`📝 Update data:`, updateData);
      
      await updateSubscription(session.shop, updateData);
      
      console.log(`✅ === SYNC COMPLETED SUCCESSFULLY ===`);
      console.log(`🎉 Plan updated from ${localSubscription.planName} to ${planName}`);
      console.log(`🚀 Redirecting to dashboard with success message`);
      
      return redirect(`/app?sync=success&plan=${planName}&message=Subscription%20updated%20successfully`);
    } else {
      console.log(`ℹ️ === SYNC NOT NEEDED ===`);
      console.log(`✅ Subscription already up to date`);
      return redirect("/app?sync=already_synced&plan=" + planName);
    }
    
  } catch (error: any) {
    console.error(`❌ === SYNC FAILED ===`);
    console.error(`💥 Error details:`, error);
    console.error(`📚 Stack trace:`, error.stack);
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