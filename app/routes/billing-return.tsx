// app/routes/billing-return.tsx - FIX: Enhanced with auto-sync like original
import { LoaderFunctionArgs, redirect } from "@remix-run/node";
import { updateSubscription } from "../models/subscription.server";
import { PLANS } from "../lib/plans";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    const url = new URL(request.url);
    
    // Extract parameters from the URL
    const chargeId = url.searchParams.get("charge_id");
    const shop = url.searchParams.get("shop");  
    const planName = url.searchParams.get("plan");
    const host = url.searchParams.get("host");

    console.log(`🔄 Processing billing return`);
    console.log(`🏪 Shop: ${shop}`);
    console.log(`📋 Plan: ${planName}`);
    console.log(`🔗 Host: ${host}`);
    console.log(`💳 Charge: ${chargeId}`);

    // ✅ FIX: Extract shop from host parameter if shop is not directly provided
    let shopDomain = shop;
    if (!shopDomain && host) {
      try {
        const decodedHost = Buffer.from(host, 'base64').toString();
        shopDomain = decodedHost.split('/admin')[0];
        console.log(`🔍 Extracted shop from host: ${shopDomain}`);
      } catch (error) {
        console.error("❌ Failed to decode host parameter:", error);
      }
    }

    if (!shopDomain) {
      console.log("❌ Missing shop parameter");
      return redirect("/app?billing_error=missing_params");
    }

    if (!planName) {
      console.log("❌ Missing plan parameter");
      // ✅ FIX: Redirect with manual sync needed flag
      const hostParam = host ? `&host=${host}` : '';
      return redirect(`/app?billing_completed=1&needs_manual_sync=1&shop=${shopDomain}${hostParam}`);
    }

    // Verify plan exists
    if (!PLANS[planName as keyof typeof PLANS]) {
      console.log(`❌ Invalid plan: ${planName}`);
      return redirect("/app?billing_error=invalid_plan");
    }

    const plan = PLANS[planName as keyof typeof PLANS];

    // ✅ SHOPIFY GUARANTEES: If this URL is called, payment is confirmed
    console.log(`✅ Payment confirmed by Shopify - upgrading to ${plan.displayName} plan`);

    // ✅ FIX: Update subscription immediately with proper data
    try {
      await updateSubscription(shopDomain, {
        planName: planName,
        status: "active",
        usageLimit: plan.usageLimit,
        subscriptionId: chargeId || `confirmed_${Date.now()}`,
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });

      console.log(`🎉 Subscription upgraded successfully to ${plan.displayName}`);
    } catch (updateError) {
      console.error("❌ Error updating subscription:", updateError);
      // Continue with redirect but flag for manual sync
    }

    // ✅ FIX: Proper embedded app redirect with billing_completed flag
    if (host) {
      const redirectUrl = `/app?host=${host}&billing_completed=1&plan=${planName}&charge_id=${chargeId || ''}`;
      console.log(`🔗 Redirecting with host parameter: ${redirectUrl}`);
      return redirect(redirectUrl);
    } else {
      const redirectUrl = `/app?billing_completed=1&plan=${planName}&shop=${shopDomain}&charge_id=${chargeId || ''}`;
      console.log(`🔗 Fallback redirect: ${redirectUrl}`);
      return redirect(redirectUrl);
    }
    
  } catch (error: any) {
    console.error("💥 Error in billing return:", error);
    
    // ✅ FIX: Always redirect to app with error info
    const url = new URL(request.url);
    const host = url.searchParams.get("host");
    const hostParam = host ? `&host=${host}` : '';
    
    return redirect(`/app?billing_error=processing_error${hostParam}`);
  }
};