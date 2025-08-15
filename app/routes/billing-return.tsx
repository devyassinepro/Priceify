// app/routes/billing-return.tsx
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

    // Récupérer les détails de la charge depuis Shopify
    const response = await admin.graphql(`
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

    const result = await response.json();
    const charge = result.data?.appRecurringApplicationCharge;

    console.log(`📊 Charge details:`, JSON.stringify(charge, null, 2));

    if (!charge) {
      console.log("❌ Charge not found");
      return redirect("/app?billing_error=charge_not_found");
    }

    if (charge.status === "active") {
      // Charge acceptée - mettre à jour l'abonnement local
      const amount = parseFloat(charge.price.amount);
      
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
      });

      // Construire l'URL de redirection vers l'app embedded
      const host = Buffer.from(`${shop}/admin`).toString('base64');
      const redirectUrl = `/app?host=${host}&shop=${shop}&billing_completed=1&plan=${detectedPlan}`;
      
      console.log(`🔗 Redirecting to: ${redirectUrl}`);
      return redirect(redirectUrl);

    } else if (charge.status === "declined") {
      console.log("❌ Charge declined by user");
      const host = Buffer.from(`${shop}/admin`).toString('base64');
      return redirect(`/app?host=${host}&shop=${shop}&billing_error=declined`);

    } else {
      console.log(`⏳ Charge status: ${charge.status}`);
      const host = Buffer.from(`${shop}/admin`).toString('base64');
      return redirect(`/app?host=${host}&shop=${shop}&billing_error=pending`);
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