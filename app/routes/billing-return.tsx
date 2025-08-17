import { LoaderFunctionArgs, redirect } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { updateSubscription } from "../models/subscription.server";
import { PLANS } from "../lib/plans";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    const { admin, session } = await authenticate.admin(request);
    const url = new URL(request.url);
    const chargeId = url.searchParams.get("charge_id");
    const shop = session.shop;

    console.log(`🔄 Processing billing return for ${shop}`);
    console.log(`💳 Charge ID: ${chargeId}`);

    if (!chargeId) {
      console.log("❌ No charge ID provided, redirecting to app");
      return redirect("/app?billing_error=no_charge_id");
    }

    // ✅ SOLUTION: Déterminer le type de charge et utiliser la bonne requête
    let charge = null;
    let isSubscription = false;

    // Essayer d'abord AppSubscription (nouveau système)
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
                    interval
                  }
                }
              }
            }
          }
        }
      `, {
        variables: { id: chargeId }
      });

      const subscriptionResult = await subscriptionResponse.json();
      charge = subscriptionResult.data?.appSubscription;
      
      if (charge) {
        console.log(`📊 Found AppSubscription:`, JSON.stringify(charge, null, 2));
        isSubscription = true;
      }
    } catch (error) {
      console.log(`ℹ️ Not an AppSubscription, trying AppRecurringApplicationCharge...`);
    }

    // Si pas trouvé comme AppSubscription, essayer AppRecurringApplicationCharge
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
              createdAt
              activatedOn
            }
          }
        `, {
          variables: { id: chargeId }
        });

        const chargeResult = await chargeResponse.json();
        charge = chargeResult.data?.appRecurringApplicationCharge;
        
        if (charge) {
          console.log(`📊 Found AppRecurringApplicationCharge:`, JSON.stringify(charge, null, 2));
          isSubscription = false;
        }
      } catch (error) {
        console.log(`❌ Error fetching charge:`, error);
      }
    }

    if (!charge) {
      console.log("❌ Charge not found in either system");
      return redirect("/app?billing_error=charge_not_found");
    }

    // Déterminer le statut selon le type
    const status = charge.status;
    console.log(`📋 Charge status: ${status}`);

    if (status === "ACTIVE" || status === "active") {
      // Charge acceptée - mettre à jour l'abonnement local
      let amount;
      
      if (isSubscription) {
        // AppSubscription
        amount = parseFloat(charge.lineItems?.[0]?.plan?.pricingDetails?.price?.amount || "0");
      } else {
        // AppRecurringApplicationCharge
        amount = parseFloat(charge.price?.amount || "0");
      }
      
      console.log(`💰 Detected amount: ${amount}`);
      
      // Mapper le montant au plan correspondant
      let detectedPlan = "free";
      for (const [planKey, planData] of Object.entries(PLANS)) {
        if (Math.abs(planData.price - amount) < 0.02) {
          detectedPlan = planKey;
          break;
        }
      }

      console.log(`✅ Charge approved - updating to ${detectedPlan} plan`);

      await updateSubscription(shop, {
        planName: detectedPlan,
        status: "active",
        usageLimit: PLANS[detectedPlan as keyof typeof PLANS].usageLimit,
        subscriptionId: chargeId,
        currentPeriodEnd: isSubscription && charge.currentPeriodEnd 
          ? new Date(charge.currentPeriodEnd) 
          : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 jours par défaut
      });

      // Construire l'URL de redirection vers l'app embedded
      const host = Buffer.from(`${shop}/admin`).toString('base64');
      const redirectUrl = `/app?host=${host}&shop=${shop}&billing_completed=1&plan=${detectedPlan}`;
      
      console.log(`🔗 Redirecting to: ${redirectUrl}`);
      return redirect(redirectUrl);

    } else if (status === "DECLINED" || status === "declined") {
      console.log("❌ Charge declined by user");
      const host = Buffer.from(`${shop}/admin`).toString('base64');
      return redirect(`/app?host=${host}&shop=${shop}&billing_error=declined`);

    } else if (status === "PENDING" || status === "pending") {
      console.log(`⏳ Charge status: ${status}`);
      const host = Buffer.from(`${shop}/admin`).toString('base64');
      return redirect(`/app?host=${host}&shop=${shop}&billing_error=pending`);

    } else {
      console.log(`❓ Unknown charge status: ${status}`);
      const host = Buffer.from(`${shop}/admin`).toString('base64');
      return redirect(`/app?host=${host}&shop=${shop}&billing_error=unknown_status`);
    }

  } catch (error: any) {
    console.error("💥 Error processing billing return:", error);
    
    // Essayer de récupérer le shop depuis l'URL ou les paramètres
    const url = new URL(request.url);
    const shop = url.searchParams.get("shop");
    
    if (shop) {
      const host = Buffer.from(`${shop}/admin`).toString('base64');
      return redirect(`/app?host=${host}&shop=${shop}&billing_error=processing_error`);
    }
    
    return redirect("/app?billing_error=unknown");
  }
};