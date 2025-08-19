// app/routes/billing-return.tsx - VERSION CORRIGÉE
import { LoaderFunctionArgs, redirect } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { autoSyncSubscription } from "../lib/auto-sync.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    const { admin, session } = await authenticate.admin(request);
    const url = new URL(request.url);
    const chargeId = url.searchParams.get("charge_id");
    const requestedPlan = url.searchParams.get("plan");
    const shop = session.shop;

    console.log(`🔄 Processing billing return for ${shop}`);
    console.log(`💳 Charge ID: ${chargeId}`);
    console.log(`📋 Requested Plan: ${requestedPlan}`);

    // Construire l'URL de base pour les redirections
    const host = Buffer.from(`${shop}/admin`).toString('base64');
    const baseAppUrl = `/app?host=${host}&shop=${shop}`;

    if (!chargeId) {
      console.log("❌ No charge ID provided, redirecting with error");
      return redirect(`${baseAppUrl}&billing_error=no_charge_id`);
    }

    // ✅ CORRECTION: Essayer l'auto-sync en premier
    console.log(`🔄 Running auto-sync for ${shop}...`);
    const syncResult = await autoSyncSubscription(admin, shop);
    
    if (syncResult.success) {
      console.log(`✅ Auto-sync successful: ${syncResult.syncedPlan}`);
      return redirect(`${baseAppUrl}&billing_completed=1&plan=${syncResult.syncedPlan}&charge_id=${chargeId}&sync_source=auto`);
    }

    console.log(`❌ Auto-sync failed: ${syncResult.error}, trying manual charge verification...`);

    // ✅ Si auto-sync échoue, vérifier manuellement la charge
    let charge = null;
    let isSubscription = false;

    // Essayer d'abord AppSubscription
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
        console.log(`📊 Found AppSubscription:`, charge);
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
          console.log(`📊 Found AppRecurringApplicationCharge:`, charge);
          isSubscription = false;
        }
      } catch (error) {
        console.log(`❌ Error fetching charge:`, error);
      }
    }

    if (!charge) {
      console.log("❌ Charge not found in either system");
      return redirect(`${baseAppUrl}&billing_error=charge_not_found&charge_id=${chargeId}`);
    }

    const status = charge.status;
    console.log(`📋 Charge status: ${status}`);

    if (status === "ACTIVE" || status === "active") {
      // ✅ CORRECTION: Synchronisation manuelle avec les bonnes données
      console.log(`✅ Charge approved - doing manual sync...`);
      
      let amount;
      if (isSubscription) {
        amount = parseFloat(charge.lineItems?.[0]?.plan?.pricingDetails?.price?.amount || "0");
      } else {
        amount = parseFloat(charge.price?.amount || "0");
      }
      
      console.log(`💰 Detected amount: ${amount}`);
      
      // Mapper le montant au plan correspondant
      const { PLANS } = await import("../lib/plans");
      const { updateSubscription } = await import("../models/subscription.server");
      
      let detectedPlan = "free";
      for (const [planKey, planData] of Object.entries(PLANS)) {
        if (Math.abs(planData.price - amount) < 0.02) {
          detectedPlan = planKey;
          break;
        }
      }

      console.log(`✅ Manual sync: updating to ${detectedPlan} plan`);

      await updateSubscription(shop, {
        planName: detectedPlan,
        status: "active",
        usageLimit: PLANS[detectedPlan as keyof typeof PLANS].usageLimit,
        subscriptionId: chargeId,
        currentPeriodEnd: isSubscription && charge.currentPeriodEnd 
          ? new Date(charge.currentPeriodEnd) 
          : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });

      console.log(`🔗 Redirecting to app with success...`);
      return redirect(`${baseAppUrl}&billing_completed=1&plan=${detectedPlan}&charge_id=${chargeId}&sync_source=manual`);

    } else if (status === "DECLINED" || status === "declined") {
      console.log("❌ Charge declined by user");
      return redirect(`${baseAppUrl}&billing_error=declined&charge_id=${chargeId}`);

    } else if (status === "PENDING" || status === "pending") {
      console.log(`⏳ Charge status: ${status}`);
      return redirect(`${baseAppUrl}&billing_error=pending&charge_id=${chargeId}`);

    } else {
      console.log(`❓ Unknown charge status: ${status}`);
      return redirect(`${baseAppUrl}&billing_error=unknown_status&status=${status}&charge_id=${chargeId}`);
    }

  } catch (error: any) {
    console.error("💥 Error processing billing return:", error);
    
    // Essayer de récupérer le shop depuis l'URL
    const url = new URL(request.url);
    const shop = url.searchParams.get("shop");
    
    if (shop) {
      const host = Buffer.from(`${shop}/admin`).toString('base64');
      return redirect(`/app?host=${host}&shop=${shop}&billing_error=processing_error&error=${encodeURIComponent(error.message)}`);
    }
    
    return redirect("/app?billing_error=unknown");
  }
};