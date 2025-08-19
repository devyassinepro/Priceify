// app/routes/billing-return.tsx - Version simple et directe
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
      console.log("❌ Missing charge ID or shop");
      return redirect("/app?billing_error=missing_params");
    }

    // ✅ SOLUTION SIMPLE: Créer un admin client directement avec les credentials de base
    const adminClient = {
      graphql: async (query: string, options: any) => {
        const response = await fetch(`https://${shop}/admin/api/2025-07/graphql.json`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Access-Token': process.env.SHOPIFY_API_SECRET!, // ou votre token d'accès
          },
          body: JSON.stringify({
            query,
            variables: options.variables
          })
        });
        return { json: async () => await response.json() };
      }
    };

    // Essayer de récupérer l'abonnement avec l'ID
    let detectedPlan = "free";
    
    try {
      console.log(`🔍 Checking AppSubscription: gid://shopify/AppSubscription/${chargeId}`);
      
      const subscriptionResponse = await adminClient.graphql(`
        query getAppSubscription($id: ID!) {
          appSubscription(id: $id) {
            id
            name
            status
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
      `, {
        variables: { id: `gid://shopify/AppSubscription/${chargeId}` }
      });

      const result = await subscriptionResponse.json();
      const subscription = result.data?.appSubscription;
      
      console.log(`📊 Subscription result:`, JSON.stringify(subscription, null, 2));

      if (subscription && subscription.status === "ACTIVE") {
        const amount = parseFloat(subscription.lineItems?.[0]?.plan?.pricingDetails?.price?.amount || "0");
        console.log(`💰 Subscription amount: $${amount}`);
        
        // Mapper au plan correspondant
        for (const [planKey, planData] of Object.entries(PLANS)) {
          if (Math.abs(planData.price - amount) < 0.02) {
            detectedPlan = planKey;
            console.log(`🎯 Detected plan: ${detectedPlan}`);
            break;
          }
        }

        if (detectedPlan !== "free") {
          // ✅ UPGRADE DIRECT EN LOCAL
          console.log(`✅ Payment approved - upgrading to ${detectedPlan} plan`);
          
          await updateSubscription(shop, {
            planName: detectedPlan,
            status: "active",
            usageLimit: PLANS[detectedPlan as keyof typeof PLANS].usageLimit,
            subscriptionId: `gid://shopify/AppSubscription/${chargeId}`,
            currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          });

          console.log(`🎉 Subscription upgraded successfully to ${detectedPlan}`);
          
          // Redirection vers l'app avec message de succès
          return redirect(`/app?billing_success=1&plan=${detectedPlan}`);
        }
      }
    } catch (error: any) {
      console.log(`❌ Error checking subscription:`, error.message);
    }

    // Si on arrive ici, quelque chose a échoué
    console.log(`⚠️ Could not process subscription upgrade`);
    return redirect(`/app?billing_error=upgrade_failed`);
    
  } catch (error: any) {
    console.error("💥 Error in billing return:", error);
    return redirect("/app?billing_error=processing_error");
  }
};