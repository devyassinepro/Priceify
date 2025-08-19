// app/routes/api.process-billing-return.tsx
import { ActionFunctionArgs, json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { updateSubscription } from "../models/subscription.server";
import { PLANS } from "../lib/plans";

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    const { admin, session } = await authenticate.admin(request);
    
    const body = await request.json();
    const { charge_id, shop } = body;
    
    console.log(`🔄 API: Processing billing return for charge: ${charge_id}`);
    
    if (!charge_id || !shop) {
      return json({ success: false, error: 'Missing charge_id or shop' }, { status: 400 });
    }

    // Vérifier que le shop correspond à la session
    if (session.shop !== shop) {
      return json({ success: false, error: 'Shop mismatch' }, { status: 403 });
    }

    let charge = null;
    let detectedPlan = "free";
    let isSubscription = false;

    // Essayer AppSubscription
    try {
      const subscriptionResponse = await admin.graphql(`
        query getAppSubscription($id: ID!) {
          appSubscription(id: $id) {
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
      `, {
        variables: { id: `gid://shopify/AppSubscription/${charge_id}` }
      });

      const subscriptionResult = await subscriptionResponse.json();
      charge = subscriptionResult.data?.appSubscription;
      
      if (charge && charge.status === "ACTIVE") {
        console.log(`📊 Found active AppSubscription`);
        isSubscription = true;
        
        const amount = parseFloat(charge.lineItems?.[0]?.plan?.pricingDetails?.price?.amount || "0");
        console.log(`💰 Amount: ${amount}`);
        
        // Mapper au plan correspondant
        for (const [planKey, planData] of Object.entries(PLANS)) {
          if (Math.abs(planData.price - amount) < 0.02) {
            detectedPlan = planKey;
            break;
          }
        }
      }
    } catch (error) {
      console.log(`ℹ️ Not an AppSubscription, trying AppRecurringApplicationCharge...`);
    }

    // Si pas trouvé, essayer AppRecurringApplicationCharge
    if (!charge) {
      try {
        const chargeResponse = await admin.graphql(`
          query getAppRecurringApplicationCharge($id: ID!) {
            appRecurringApplicationCharge(id: $id) {
              id
              name
              price {
                amount
                currencyCode
              }
              status
            }
          }
        `, {
          variables: { id: `gid://shopify/AppRecurringApplicationCharge/${charge_id}` }
        });

        const chargeResult = await chargeResponse.json();
        charge = chargeResult.data?.appRecurringApplicationCharge;
        
        if (charge && charge.status === "active") {
          console.log(`📊 Found active AppRecurringApplicationCharge`);
          isSubscription = false;
          
          const amount = parseFloat(charge.price?.amount || "0");
          console.log(`💰 Amount: ${amount}`);
          
          // Mapper au plan correspondant
          for (const [planKey, planData] of Object.entries(PLANS)) {
            if (Math.abs(planData.price - amount) < 0.02) {
              detectedPlan = planKey;
              break;
            }
          }
        }
      } catch (error) {
        console.log(`❌ Error fetching charge:`, error);
      }
    }

    // Si on a trouvé un abonnement actif, mettre à jour localement
    if (charge && detectedPlan !== "free") {
      console.log(`✅ API: Updating subscription to ${detectedPlan} plan`);
      
      await updateSubscription(session.shop, {
        planName: detectedPlan,
        status: "active",
        usageLimit: PLANS[detectedPlan as keyof typeof PLANS].usageLimit,
        subscriptionId: isSubscription ? `gid://shopify/AppSubscription/${charge_id}` : `gid://shopify/AppRecurringApplicationCharge/${charge_id}`,
        currentPeriodEnd: isSubscription && charge.currentPeriodEnd 
          ? new Date(charge.currentPeriodEnd) 
          : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });

      console.log(`🎉 API: Subscription successfully updated to ${detectedPlan}`);
      
      return json({ 
        success: true, 
        plan: detectedPlan,
        message: `Subscription updated to ${PLANS[detectedPlan as keyof typeof PLANS].displayName} plan`
      });
    } else {
      console.log(`⚠️ API: Could not process billing - charge not found or not active`);
      return json({ 
        success: false, 
        error: "Charge not found or not active" 
      }, { status: 400 });
    }
    
  } catch (error: any) {
    console.error("❌ API: Error processing billing return:", error);
    return json({ 
      success: false, 
      error: error.message 
    }, { status: 500 });
  }
};