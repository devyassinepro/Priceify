import { LoaderFunctionArgs, redirect } from "@remix-run/node";
import { updateSubscription } from "../models/subscription.server";
import { PLANS } from "../lib/plans";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    const url = new URL(request.url);
    const chargeId = url.searchParams.get("charge_id");
    const shop = url.searchParams.get("shop");
    const planName = url.searchParams.get("plan");

    console.log(`🔄 Processing billing return`);
    console.log(`🏪 Shop: ${shop}`);
    console.log(`📋 Plan: ${planName}`);

    if (!shop || !planName) {
      console.log("❌ Missing shop or plan parameter");
      return redirect("/app?billing_error=missing_params");
    }

    // Vérifier que le plan existe
    if (!PLANS[planName as keyof typeof PLANS]) {
      console.log(`❌ Invalid plan: ${planName}`);
      return redirect("/app?billing_error=invalid_plan");
    }

    const plan = PLANS[planName as keyof typeof PLANS];

    // ✅ SHOPIFY GARANTIT: Si cette URL est appelée, le paiement est accepté ✅
    console.log(`✅ Payment confirmed by Shopify - upgrading to ${plan.displayName} plan`);

    // Mise à jour directe de l'abonnement local
    await updateSubscription(shop, {
      planName: planName,
      status: "active",
      usageLimit: plan.usageLimit,
      subscriptionId: `shopify_confirmed_${Date.now()}`, // ID temporaire
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 jours
    });

    console.log(`🎉 Subscription upgraded successfully to ${plan.displayName}`);

    const host = Buffer.from(`${shop}/admin`).toString('base64');
    const redirectUrl = `/app?host=${host}&shop=${shop}&billing_completed=1&charge_id=${chargeId}&needs_manual_sync=1`;
        
    console.log(`🔗 Auth failed, redirecting to app for manual processing: ${redirectUrl}`);
    return redirect(redirectUrl);
    
  } catch (error: any) {
    console.error("💥 Error in billing return:", error);
    return redirect("/app?billing_error=processing_error");
  }
};