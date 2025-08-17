// app/routes/webhooks.app.subscription_charges_success.tsx
// Alternative : Utiliser un webhook pour gérer les paiements approuvés

import type { ActionFunctionArgs } from "@remix-run/node";
import { updateSubscription } from "../models/subscription.server";
import { PLANS } from "../lib/plans";

export const action = async ({ request }: ActionFunctionArgs) => {
  console.log("🔄 Subscription charge success webhook received");
  
  try {
    // Lire le payload du webhook
    const payload = await request.text();
    console.log(`📦 Webhook payload:`, payload);

    // Parser les données
    const data = JSON.parse(payload);
    const charge = data.app_recurring_application_charge || data.app_subscription;
    
    if (!charge) {
      console.error("❌ No charge data in webhook payload");
      return new Response("Missing charge data", { status: 400 });
    }

    const shop = data.shop_domain || charge.shop_domain;
    const amount = parseFloat(charge.price?.amount || charge.line_items?.[0]?.plan?.pricing_details?.price?.amount || "0");
    const status = charge.status;
    const chargeId = charge.id;

    console.log(`📋 Processing charge for ${shop}:`);
    console.log(`💰 Amount: $${amount}`);
    console.log(`📊 Status: ${status}`);
    console.log(`🆔 ID: ${chargeId}`);

    if (status === "active" || status === "ACTIVE") {
      // Mapper le montant au plan correspondant
      let detectedPlan = "free";
      for (const [planKey, planData] of Object.entries(PLANS)) {
        if (Math.abs(planData.price - amount) < 0.02) {
          detectedPlan = planKey;
          break;
        }
      }

      console.log(`✅ Updating subscription to ${detectedPlan} plan`);

      await updateSubscription(shop, {
        planName: detectedPlan,
        status: "active",
        usageLimit: PLANS[detectedPlan as keyof typeof PLANS].usageLimit,
        subscriptionId: chargeId.toString(),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });

      console.log(`✅ Subscription updated successfully for ${shop}`);
    }

    return new Response("OK", { status: 200 });
    
  } catch (error: any) {
    console.error("❌ Webhook processing error:", error);
    return new Response("Internal Server Error", { status: 500 });
  }
};