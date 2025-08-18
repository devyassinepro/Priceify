// app/routes/billing-return.tsx - Version corrigée avec gestion d'authentification
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

    // ✅ SOLUTION 1: Authentification avec le shop explicite
    let admin;
    try {
      const { authenticate } = await import("../shopify.server");
      const authResult = await authenticate.admin(request);
      admin = authResult.admin;
      console.log(`✅ Authentication successful for ${authResult.session.shop}`);
    } catch (authError: any) {
      console.log(`❌ Authentication failed:`, authError.message);
      
      // ✅ SOLUTION 2: Si l'auth échoue, essayer une approche alternative
      // Créer une URL de redirection vers l'app avec les paramètres de billing
      const host = Buffer.from(`${shop}/admin`).toString('base64');
      const redirectUrl = `/app?host=${host}&shop=${shop}&billing_completed=1&charge_id=${chargeId}&needs_manual_sync=1`;
      
      console.log(`🔗 Auth failed, redirecting to app for manual processing: ${redirectUrl}`);
      return redirect(redirectUrl);
    }

    // ✅ SOLUTION 3: Déterminer le type de charge et récupérer les détails
    let charge = null;
    let isSubscription = false;
    let detectedPlan = "free";

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
        variables: { id: `gid://shopify/AppSubscription/${chargeId}` }
      });

      const subscriptionResult = await subscriptionResponse.json();
      charge = subscriptionResult.data?.appSubscription;
      
      if (charge) {
        console.log(`📊 Found AppSubscription:`, JSON.stringify(charge, null, 2));
        isSubscription = true;
        
        // Extraire le montant pour AppSubscription
        const amount = parseFloat(charge.lineItems?.[0]?.plan?.pricingDetails?.price?.amount || "0");
        console.log(`💰 AppSubscription amount: ${amount}`);
        
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
          variables: { id: `gid://shopify/AppRecurringApplicationCharge/${chargeId}` }
        });

        const chargeResult = await chargeResponse.json();
        charge = chargeResult.data?.appRecurringApplicationCharge;
        
        if (charge) {
          console.log(`📊 Found AppRecurringApplicationCharge:`, JSON.stringify(charge, null, 2));
          isSubscription = false;
          
          // Extraire le montant pour AppRecurringApplicationCharge
          const amount = parseFloat(charge.price?.amount || "0");
          console.log(`💰 AppRecurringApplicationCharge amount: ${amount}`);
          
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

    if (!charge) {
      console.log("❌ Charge not found in either system");
      const host = Buffer.from(`${shop}/admin`).toString('base64');
      return redirect(`/app?host=${host}&shop=${shop}&billing_error=charge_not_found`);
    }

    // Déterminer le statut selon le type
    const status = charge.status;
    console.log(`📋 Charge status: ${status}`);
    console.log(`🎯 Detected plan: ${detectedPlan}`);

    if (status === "ACTIVE" || status === "active") {
      // ✅ SOLUTION 4: Mise à jour IMMÉDIATE de l'abonnement local
      console.log(`✅ Charge approved - updating to ${detectedPlan} plan IMMEDIATELY`);

      await updateSubscription(shop, {
        planName: detectedPlan,
        status: "active",
        usageLimit: PLANS[detectedPlan as keyof typeof PLANS].usageLimit,
        subscriptionId: isSubscription ? `gid://shopify/AppSubscription/${chargeId}` : `gid://shopify/AppRecurringApplicationCharge/${chargeId}`,
        currentPeriodEnd: isSubscription && charge.currentPeriodEnd 
          ? new Date(charge.currentPeriodEnd) 
          : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 jours par défaut
      });

      console.log(`🎉 Subscription successfully updated to ${detectedPlan}`);

      // ✅ SOLUTION 5: Redirection avec trigger de sync automatique
      const host = Buffer.from(`${shop}/admin`).toString('base64');
      const redirectUrl = `/app?host=${host}&shop=${shop}&billing_completed=1&plan=${detectedPlan}&trigger_sync=1&sync_needed=1`;
      
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
    
    // Essayer de récupérer le shop depuis l'URL
    const url = new URL(request.url);
    const shop = url.searchParams.get("shop");
    
    if (shop) {
      const host = Buffer.from(`${shop}/admin`).toString('base64');
      return redirect(`/app?host=${host}&shop=${shop}&billing_error=processing_error`);
    }
    
    return redirect("/app?billing_error=unknown");
  }
};