// app/routes/app._index.tsx - COMPLETE FILE with modification tracking
import { json, LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, Link, useSearchParams } from "@remix-run/react";
import { authenticate } from "../shopify.server";
import {
  Card,
  Layout,
  Page,
  Text,
  Button,
  ButtonGroup,
  Banner,
  Grid,
  ProgressBar,
  Icon,
  BlockStack,
  InlineStack,
} from "@shopify/polaris";
import {
  PriceListIcon,
  ChartVerticalIcon,
  CheckCircleIcon,
  PlanIcon,
} from "@shopify/polaris-icons";
import { getSubscriptionStats } from "../models/subscription.server";
import { getPlan, formatPriceDisplay, PLANS, formatUsageDisplay, hasUnlimitedProducts } from "../lib/plans";
import { autoSyncSubscription } from "../lib/auto-sync.server";
import { useEffect } from "react";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  
  const url = new URL(request.url);
  console.log(`🏠 App index loaded for ${session.shop}`);

  // ✅ FIX: Detect billing completion parameters
  const billingCompleted = url.searchParams.get("billing_completed");
  const billingSuccess = url.searchParams.get("billing_success"); 
  const planUpgraded = url.searchParams.get("plan");
  const billingError = url.searchParams.get("billing_error");
  const needsManualSync = url.searchParams.get("needs_manual_sync");
  const chargeId = url.searchParams.get("charge_id");
  
  let billingMessage = null;
  let billingStatus = null;
  let autoSyncResult = null;
  
  // ✅ FIX: Force auto-sync when billing is completed OR billing_success=1
  if ((billingCompleted === "1" || billingSuccess === "1") && planUpgraded) {
    billingStatus = "success";
    console.log(`✅ Billing completion detected: ${planUpgraded} plan, charge: ${chargeId}`);
    
    // ✅ FIX: Force comprehensive auto-sync to detect the new subscription
    try {
      console.log(`🔄 Force syncing subscription after billing completion...`);
      autoSyncResult = await autoSyncSubscription(admin, session.shop);
      
      if (autoSyncResult?.success) {
        const detectedPlan = PLANS[autoSyncResult.syncedPlan as keyof typeof PLANS]?.displayName || autoSyncResult.syncedPlan;
        billingMessage = `🎉 Payment successful! You're now on the ${detectedPlan} plan. Your new limits are active immediately.`;
        console.log(`✅ Auto-sync successful after billing: ${autoSyncResult.message}`);
      } else {
        // ✅ FIX: If auto-sync fails, try to update manually based on the plan parameter
        console.log(`⚠️ Auto-sync failed, attempting manual update based on plan parameter: ${planUpgraded}`);
        
        if (PLANS[planUpgraded as keyof typeof PLANS]) {
          const { updateSubscription } = await import("../models/subscription.server");
          const plan = PLANS[planUpgraded as keyof typeof PLANS];
          
          await updateSubscription(session.shop, {
            planName: planUpgraded,
            status: "active",
            usageLimit: plan.usageLimit,
            subscriptionId: chargeId || `manual_${Date.now()}`,
            currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          });
          
          billingMessage = `🎉 Payment successful! You're now on the ${plan.displayName} plan. Your new limits are active.`;
          console.log(`✅ Manual plan update successful: ${plan.displayName}`);
        } else {
          billingMessage = `✅ Payment processed! Please refresh the page to see your new plan.`;
        }
      }
    } catch (error) {
      console.error("❌ Error during post-billing sync:", error);
      billingMessage = `✅ Payment successful! Your plan is being updated. Please refresh if you don't see changes shortly.`;
    }
  }
  
  // Handle manual sync needed cases
  if (needsManualSync === "1" && !billingStatus) {
    console.log(`🔄 Manual sync needed after billing return...`);
    
    try {
      autoSyncResult = await autoSyncSubscription(admin, session.shop);
      
      if (autoSyncResult?.success) {
        billingStatus = "success";
        const detectedPlan = PLANS[autoSyncResult.syncedPlan as keyof typeof PLANS]?.displayName || autoSyncResult.syncedPlan;
        billingMessage = `🎉 Plan synchronized! You're now on the ${detectedPlan} plan.`;
        console.log(`✅ Manual sync successful: ${autoSyncResult.message}`);
      } else {
        console.log(`ℹ️ Manual sync result: ${autoSyncResult?.message || autoSyncResult?.error}`);
      }
    } catch (error) {
      console.error("❌ Manual sync error:", error);
    }
  }
  
  // Handle billing errors
  if (billingError && !billingStatus) {
    billingStatus = "error";
    switch (billingError) {
      case "missing_params":
        billingMessage = "❌ Invalid payment information. Please try again.";
        break;
      case "upgrade_failed":
        billingMessage = "⚠️ Payment processed but plan activation failed. Please use manual sync.";
        break;
      case "processing_error":
        billingMessage = "⚠️ There was an error processing your payment. Please try again.";
        break;
      default:
        billingMessage = "⚠️ There was an issue with your payment. Please try again.";
    }
  }

  // ✅ FIX: Always get fresh subscription data after potential updates
  const subscriptionStats = await getSubscriptionStats(session.shop);
  
  // Force a usage count sync to ensure accuracy
  try {
    const { syncUsageCount } = await import("../models/subscription.server");
    const syncResult = await syncUsageCount(session.shop);
    if (syncResult.synced) {
      // console.log(`🔄 Usage count synced: ${syncResult.oldCount} -> ${syncResult.newCount}`);
    }
  } catch (syncError) {
    console.warn("⚠️ Usage count sync warning:", syncError);
  }
  
  // Re-fetch final subscription data
  const finalSubscriptionStats = await getSubscriptionStats(session.shop);
  
  const planData = getPlan(finalSubscriptionStats.planName);
  const isUnlimited = hasUnlimitedProducts(finalSubscriptionStats.planName);
  const usagePercentage = isUnlimited ? 0 : (finalSubscriptionStats.usageCount / finalSubscriptionStats.usageLimit) * 100;
  const remainingProducts = isUnlimited ? "unlimited" : Math.max(0, finalSubscriptionStats.usageLimit - finalSubscriptionStats.usageCount);
  
  console.log(`📊 Final dashboard stats:`, {
    plan: finalSubscriptionStats.planName,
    usageCount: finalSubscriptionStats.usageCount,
    usageLimit: finalSubscriptionStats.usageLimit,
    isUnlimited,
    usagePercentage: usagePercentage.toFixed(1) + '%',
    remainingProducts,
    syncedPlan: autoSyncResult?.syncedPlan || null
  });

  return json({
    shop: session.shop,
    subscription: finalSubscriptionStats,
    plan: planData,
    usagePercentage,
    remainingProducts,
    uniqueProductCount: finalSubscriptionStats.uniqueProductCount || 0,
    billingStatus,
    billingMessage,
    autoSyncResult,
    isUnlimited,
  });
};

export default function Index() {
  const { 
    shop, 
    subscription, 
    plan, 
    usagePercentage, 
    remainingProducts, 
    uniqueProductCount,
    billingStatus,
    billingMessage,
    autoSyncResult,
    isUnlimited,
  } = useLoaderData<typeof loader>();
  
  const [searchParams, setSearchParams] = useSearchParams();

  const isNewUser = subscription.usageCount === 0;
  const isNearLimit = !isUnlimited && usagePercentage > 80;
  const hasReachedLimit = !isUnlimited && usagePercentage >= 100;

  // ✅ FIX: Clean up parameters after display but keep them longer for manual sync
  useEffect(() => {
    if (billingStatus || autoSyncResult) {
      const timer = setTimeout(() => {
        const params = new URLSearchParams(searchParams);
        // Clean billing parameters
        params.delete("billing_success");
        params.delete("billing_completed");
        params.delete("billing_error");
        params.delete("plan");
        params.delete("upgraded");
        params.delete("charge_id");
        params.delete("needs_manual_sync");
        // Clean sync parameters
        params.delete("sync");
        params.delete("sync_plan");
        params.delete("message");
        params.delete("sync_needed");
        params.delete("trigger_sync");
        // Clean embedded parameters but keep host
        params.delete("shop");
        params.delete("hmac");
        params.delete("embedded");
        params.delete("id_token");
        params.delete("locale");
        params.delete("session");
        params.delete("timestamp");
        setSearchParams(params, { replace: true });
      }, 8000); // ✅ FIX: Longer timeout to allow user to see the changes
      
      return () => clearTimeout(timer);
    }
  }, [billingStatus, autoSyncResult, searchParams, setSearchParams]);

  return (
    <Page title="Dashboard" subtitle={`Dynamic Pricing for ${shop}`}>
      <Layout>
        {/* Auto-sync result banner */}
        {autoSyncResult?.success && !billingStatus && (
          <Layout.Section>
            <Banner title="🔄 Subscription Auto-Synced!" tone="success">
              <Text as="p">{autoSyncResult.message}</Text>
            </Banner>
          </Layout.Section>
        )}

        {/* ✅ FIX: Enhanced billing success banner with refresh option */}
        {billingStatus === "success" && billingMessage && (
          <Layout.Section>
            <Banner title="🎉 Payment Successful!" tone="success">
              <Text as="p">{billingMessage}</Text>
              <div style={{ marginTop: "1rem", display: "flex", gap: "1rem", flexWrap: "wrap" }}>
                <Link to="/app/pricing">
                  <Button variant="primary">Start Using New Features</Button>
                </Link>
                <Button onClick={() => window.location.reload()}>
                  Refresh Dashboard
                </Button>
              </div>
              <Text as="p" variant="bodySm" tone="subdued">
                ✅ Current plan: <strong>{plan.displayName}</strong> | Limit: <strong>{isUnlimited ? 'Unlimited' : subscription.usageLimit.toLocaleString()}</strong> modifications/month
              </Text>
            </Banner>
          </Layout.Section>
        )}
        
        {billingStatus === "error" && billingMessage && (
          <Layout.Section>
            <Banner title="⚠️ Payment Issue" tone="critical">
              <Text as="p">{billingMessage}</Text>
              <div style={{ marginTop: "1rem" }}>
                <Link to="/app/billing">
                  <Button variant="primary">Try Again</Button>
                </Link>
              </div>
            </Banner>
          </Layout.Section>
        )}

        {/* ✅ UPDATED: Usage warnings with modification language */}
        {isNearLimit && !billingStatus && (
          <Layout.Section>
            <Banner 
              title={hasReachedLimit ? "Modification Limit Reached" : "Approaching Modification Limit"}
              tone={hasReachedLimit ? "critical" : "warning"}
              action={hasReachedLimit ? {
                content: "Upgrade Now",
                url: "/app/billing"
              } : {
                content: "View Plans", 
                url: "/app/billing"
              }}
            >
              <Text as="p">
                You've used {subscription.usageCount.toLocaleString()} of {subscription.usageLimit.toLocaleString()} allowed modifications this month
                {hasReachedLimit ? ". Upgrade to continue making changes." : "."}
              </Text>
            </Banner>
          </Layout.Section>
        )}

        {/* ✅ UPDATED: Statistics cards with modification tracking */}
        <Layout.Section>
          <Grid>
            <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3, xl: 3 }}>
              <Card>
                <div style={{ padding: "1.5rem", textAlign: "center" }}>
                  <div style={{ marginBottom: "0.5rem" }}>
                    <Icon source={PlanIcon} />
                  </div>
                  <Text as="h3" variant="headingMd">Current Plan</Text>
                  <Text as="p" variant="bodyLg" tone={plan.name === "free" ? "subdued" : "success"}>
                    {plan.displayName}
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    {formatPriceDisplay(plan.price)}
                  </Text>
                </div>
              </Card>
            </Grid.Cell>

            <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3, xl: 3 }}>
              <Card>
                <div style={{ padding: "1.5rem", textAlign: "center" }}>
                  <div style={{ marginBottom: "0.5rem" }}>
                    <Icon source={ChartVerticalIcon} />
                  </div>
                  <Text as="h3" variant="headingMd">Total Modifications</Text>
                  <Text as="p" variant="bodyLg">
                    {isUnlimited ? 
                      `${subscription.usageCount.toLocaleString()} / unlimited` :
                      `${subscription.usageCount.toLocaleString()} / ${subscription.usageLimit.toLocaleString()}`
                    }
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Product modifications this month
                  </Text>
                  {!isUnlimited && (
                    <div style={{ marginTop: "0.5rem" }}>
                      <ProgressBar 
                        progress={usagePercentage} 
                        size="small"
                        tone={hasReachedLimit ? "critical" : "primary"}
                      />
                    </div>
                  )}
                </div>
              </Card>
            </Grid.Cell>

            <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3, xl: 3 }}>
              <Card>
                <div style={{ padding: "1.5rem", textAlign: "center" }}>
                  <div style={{ marginBottom: "0.5rem" }}>
                    <Icon source={CheckCircleIcon} />
                  </div>
                  <Text as="h3" variant="headingMd">Unique Products</Text>
                  <Text as="p" variant="bodyLg" tone="success">
                    {uniqueProductCount.toLocaleString()}
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Different products modified
                  </Text>
                  {uniqueProductCount > 0 && subscription.usageCount > uniqueProductCount && (
                    <Text as="p" variant="bodySm">
                      {(subscription.usageCount / uniqueProductCount).toFixed(1)} avg modifications per product
                    </Text>
                  )}
                </div>
              </Card>
            </Grid.Cell>

            <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3, xl: 3 }}>
              <Card>
                <div style={{ padding: "1.5rem", textAlign: "center" }}>
                  <div style={{ marginBottom: "0.5rem" }}>
                    <Icon source={PriceListIcon} />
                  </div>
                  <Text as="h3" variant="headingMd">Remaining</Text>
                  <Text as="p" variant="bodyLg" tone={
                    isUnlimited ? "success" : 
                    typeof remainingProducts === 'string' || remainingProducts > 0 ? "success" : "critical"
                  }>
                    {isUnlimited ? "Unlimited" : 
                     typeof remainingProducts === 'string' ? remainingProducts : 
                     remainingProducts.toLocaleString()}
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    {isUnlimited ? "No limits!" : 
                     `modifications until ${new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toLocaleDateString()}`}
                  </Text>
                </div>
              </Card>
            </Grid.Cell>
          </Grid>
        </Layout.Section>

        {/* ✅ UPDATED: Main actions with modification explanation */}
        <Layout.Section>
          <Grid>
            <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 4, lg: 8, xl: 8 }}>
              <Card>
                <div style={{ padding: "2rem" }}>
                  <BlockStack gap="400">
                    <div>
                      <Text as="h2" variant="headingLg">Ready to optimize your pricing?</Text>
                      <Text as="p" tone="subdued">
                        Use our intelligent pricing tools to boost your revenue. Each product modification counts toward your monthly limit.
                      </Text>
                    </div>
                    
                    <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
                      <Link to="/app/pricing">
                        <Button variant="primary" size="large" disabled={hasReachedLimit}>
                          {hasReachedLimit ? "Upgrade to Continue" : "Update Prices"}
                        </Button>
                      </Link>
                      
                      <Link to="/app/history">
                        <Button size="large">View History</Button>
                      </Link>

                      {plan.name === "free" && (
                        <Link to="/app/billing">
                          <Button size="large" tone="success">
                            🚀 View Pricing Plans
                          </Button>
                        </Link>
                      )}
                    
                      <Link to="/app/billing">
                        <Button size="large">
                           Subscription
                        </Button>
                      </Link>
                    </div>
                  </BlockStack>
                </div>
              </Card>
            </Grid.Cell>
            
            <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 4, lg: 4, xl: 4 }}>
              <Card>
                <div style={{ padding: "1.5rem" }}>
                  <BlockStack gap="300">
                    <Text as="h3" variant="headingMd">How quota works</Text>
                    
                    <div>
                      <Text as="p" variant="bodySm">
                        <strong>📊 Each product modification = 1 usage</strong>
                      </Text>
                      <Text as="p" variant="bodySm">
                        • Modify Product A → 1 usage
                      </Text>
                      <Text as="p" variant="bodySm">
                        • Modify Product A again → 1 more usage
                      </Text>
                      <Text as="p" variant="bodySm">
                        • Modify multiple variants of Product B → 1 usage total
                      </Text>
                      <Text as="p" variant="bodySm">
                        <strong>💡 Tip:</strong> You can modify all variants of a product in one action!
                      </Text>
                    </div>
                  </BlockStack>
                </div>
              </Card>
            </Grid.Cell>
          </Grid>
        </Layout.Section>

        {/* Rest of the component remains the same... */}
      </Layout>
    </Page>
  );
}