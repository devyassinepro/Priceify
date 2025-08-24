// app/routes/app._index.tsx - Fixed dashboard display
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
import { smartAutoSync } from "../lib/auto-sync.server";
import { useEffect } from "react";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  
  const url = new URL(request.url);
  console.log(`🏠 App index loaded for ${session.shop}`);

  // Detect billing success parameters
  const billingSuccess = url.searchParams.get("billing_success");
  const planUpgraded = url.searchParams.get("plan");
  const billingError = url.searchParams.get("billing_error");
  
  let billingMessage = null;
  let billingStatus = null;
  let autoSyncResult = null;
  
  // Handle billing success
  if (billingSuccess === "1" && planUpgraded) {
    billingStatus = "success";
    billingMessage = `🎉 Payment successful! You're now on the ${PLANS[planUpgraded as keyof typeof PLANS]?.displayName || planUpgraded} plan.`;
    console.log(`✅ Billing success detected: ${planUpgraded} plan`);
    
    autoSyncResult = {
      success: true,
      syncedPlan: planUpgraded,
      message: `Billing successful: ${planUpgraded} plan activated`
    };
  }
  
  // Handle billing errors
  if (billingError && !billingStatus) {
    billingStatus = "error";
    switch (billingError) {
      case "missing_params":
        billingMessage = "❌ Invalid payment information. Please try again.";
        break;
      case "upgrade_failed":
        billingMessage = "⚠️ Payment processed but plan activation failed. Please contact support.";
        break;
      case "processing_error":
        billingMessage = "⚠️ There was an error processing your payment. Please try again.";
        break;
      default:
        billingMessage = "⚠️ There was an issue with your payment. Please try again.";
    }
  }

  // Auto-sync intelligent (only if no billing in progress)
  if (!billingStatus) {
    try {
      autoSyncResult = await smartAutoSync(admin, session.shop);
      
      if (autoSyncResult?.success) {
        console.log(`✅ Smart auto-sync successful: ${autoSyncResult.message}`);
      } else if (autoSyncResult) {
        console.log(`ℹ️ Smart auto-sync: ${autoSyncResult.message || autoSyncResult.error}`);
      }
    } catch (error) {
      console.error("❌ Smart auto-sync error:", error);
    }
  }
  
  // Get subscription data (after upgrade or sync)
  const subscriptionStats = await getSubscriptionStats(session.shop);
  const planData = getPlan(subscriptionStats.planName);

  // ✅ FIX: Proper calculation of usage and limits
  const isUnlimited = hasUnlimitedProducts(subscriptionStats.planName);
  const usagePercentage = isUnlimited ? 0 : (subscriptionStats.usageCount / subscriptionStats.usageLimit) * 100;
  const remainingProducts = isUnlimited ? "unlimited" : Math.max(0, subscriptionStats.usageLimit - subscriptionStats.usageCount);
  
  console.log(`📊 Dashboard stats:`, {
    plan: subscriptionStats.planName,
    usageCount: subscriptionStats.usageCount,
    usageLimit: subscriptionStats.usageLimit,
    isUnlimited,
    usagePercentage: usagePercentage.toFixed(1) + '%',
    remainingProducts
  });

  // Existing sync parameters (keep for compatibility)
  const syncStatus = url.searchParams.get("sync");
  const syncPlan = url.searchParams.get("sync_plan");
  const syncMessage = url.searchParams.get("message");
  
  return json({
    shop: session.shop,
    subscription: subscriptionStats,
    plan: planData,
    usagePercentage,
    remainingProducts,
    uniqueProductCount: subscriptionStats.uniqueProductCount || 0,
    billingStatus,
    billingMessage,
    syncStatus,
    syncPlan,
    syncMessage,
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
    syncStatus,
    syncPlan,
    syncMessage,
    autoSyncResult,
    isUnlimited,
  } = useLoaderData<typeof loader>();
  
  const [searchParams, setSearchParams] = useSearchParams();

  const isNewUser = subscription.usageCount === 0;
  const isNearLimit = !isUnlimited && usagePercentage > 80;
  const hasReachedLimit = !isUnlimited && usagePercentage >= 100;

  // Clean up parameters after display
  useEffect(() => {
    if (billingStatus || syncStatus || autoSyncResult) {
      const timer = setTimeout(() => {
        const params = new URLSearchParams(searchParams);
        // Clean billing parameters
        params.delete("billing_success");
        params.delete("billing_error");
        params.delete("plan");
        params.delete("upgraded");
        // Clean sync parameters
        params.delete("sync");
        params.delete("sync_plan");
        params.delete("message");
        params.delete("sync_needed");
        params.delete("trigger_sync");
        // Clean embedded parameters
        params.delete("host");
        params.delete("shop");
        params.delete("hmac");
        params.delete("embedded");
        params.delete("id_token");
        params.delete("locale");
        params.delete("session");
        params.delete("timestamp");
        setSearchParams(params, { replace: true });
      }, 5000);
      
      return () => clearTimeout(timer);
    }
  }, [billingStatus, syncStatus, autoSyncResult, searchParams, setSearchParams]);

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

        {/* Billing banners */}
        {billingStatus === "success" && billingMessage && (
          <Layout.Section>
            <Banner title="🎉 Payment Successful!" tone="success">
              <Text as="p">{billingMessage}</Text>
              <Text as="p" variant="bodySm" tone="subdued">
                ✅ Your subscription has been automatically updated.
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
                <span style={{ marginLeft: "1rem" }}>
                  <Link to="/app/manual-sync">
                    <Button>Manual Sync</Button>
                  </Link>
                </span>
              </div>
            </Banner>
          </Layout.Section>
        )}

        {/* Sync banners */}
        {syncStatus === "success" && (
          <Layout.Section>
            <Banner title="🎉 Subscription Updated!" tone="success">
              <Text as="p">
                Your subscription has been successfully updated to the {syncPlan} plan. 
                You can now modify up to {isUnlimited ? 'unlimited' : plan.usageLimit.toLocaleString()} products per month.
              </Text>
            </Banner>
          </Layout.Section>
        )}
        
        {syncStatus === "no_subscription" && (
          <Layout.Section>
            <Banner title="ℹ️ No Active Subscription" tone="info">
              <Text as="p">
                You're currently on the free plan. Visit our pricing page to upgrade and unlock more features.
              </Text>
            </Banner>
          </Layout.Section>
        )}
        
        {syncStatus === "error" && (
          <Layout.Section>
            <Banner title="⚠️ Sync Error" tone="warning">
              <Text as="p">
                There was an issue synchronizing your subscription: {syncMessage}. 
                Please try refreshing the page or contact support if the issue persists.
              </Text>
            </Banner>
          </Layout.Section>
        )}

        {/* Usage warnings */}
        {isNearLimit && !billingStatus && !syncStatus && (
          <Layout.Section>
            <Banner 
              title={hasReachedLimit ? "Product Limit Reached" : "Approaching Product Limit"}
              tone={hasReachedLimit ? "critical" : "warning"}
              action={hasReachedLimit ? {
                content: "View Pricing Plans",
                url: "/app/billing"
              } : {
                content: "View Pricing Plans",
                url: "/app/billing"
              }}
            >
              <Text as="p">
                You've modified {subscription.usageCount.toLocaleString()} of {subscription.usageLimit.toLocaleString()} allowed unique products this month
                {hasReachedLimit ? ". Upgrade to continue making changes." : "."}
              </Text>
            </Banner>
          </Layout.Section>
        )}

        {/* Quick statistics */}
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
                  <Text as="h3" variant="headingMd">Products Modified</Text>
                  <Text as="p" variant="bodyLg">
                    {formatUsageDisplay(subscription.usageCount, subscription.usageLimit)}
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Unique products this month
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
                  <Text as="h3" variant="headingMd">Products Remaining</Text>
                  <Text as="p" variant="bodyLg" tone={typeof remainingProducts === 'string' || remainingProducts > 0 ? "success" : "critical"}>
                    {typeof remainingProducts === 'string' ? remainingProducts : remainingProducts.toLocaleString()}
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    {isUnlimited ? "No limits!" : `until ${new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toLocaleDateString()}`}
                  </Text>
                </div>
              </Card>
            </Grid.Cell>

            <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3, xl: 3 }}>
              <Card>
                <div style={{ padding: "1.5rem", textAlign: "center" }}>
                  <div style={{ marginBottom: "0.5rem" }}>
                    <Icon source={PriceListIcon} />
                  </div>
                  <Text as="h3" variant="headingMd">Total Price Changes</Text>
                  <Text as="p" variant="bodyLg">
                    {(subscription.totalPriceChanges || 0).toLocaleString()}
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Individual changes made
                  </Text>
                </div>
              </Card>
            </Grid.Cell>
          </Grid>
        </Layout.Section>

        {/* Main actions */}
        <Layout.Section>
          <Grid>
            <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 4, lg: 8, xl: 8 }}>
              <Card>
                <div style={{ padding: "2rem" }}>
                  <BlockStack gap="400">
                    <div>
                      <Text as="h2" variant="headingLg">Ready to optimize your pricing?</Text>
                      <Text as="p" tone="subdued">
                        Use our intelligent pricing tools to boost your revenue. Modify as many prices as you want per product!
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
                    <Text as="h3" variant="headingMd">How it works</Text>
                    
                    <div>
                      <Text as="p" variant="bodySm">
                        <strong>1. Select</strong> products to modify (counts toward quota)
                      </Text>
                      <Text as="p" variant="bodySm">
                        <strong>2. Choose</strong> adjustment type (%, fixed price, etc.)
                      </Text>
                      <Text as="p" variant="bodySm">
                        <strong>3. Preview</strong> changes before applying
                      </Text>
                      <Text as="p" variant="bodySm">
                        <strong>4. Apply</strong> updates (modify variants freely within each product)
                      </Text>
                      {plan.name === "free" && (
                        <Text as="p" variant="bodySm" tone="subdued">
                          <strong>5. Upgrade</strong> to modify more products per month
                        </Text>
                      )}
                    </div>
                  </BlockStack>
                </div>
              </Card>
            </Grid.Cell>
          </Grid>
        </Layout.Section>

        {/* Welcome message for new users */}
        {isNewUser && !billingStatus && !syncStatus && (
          <Layout.Section>
            <Card>
              <div style={{ 
                padding: "2rem", 
                textAlign: "center",
                background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
                color: "white",
                borderRadius: "8px"
              }}>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingLg" tone="inherit">
                    🎉 Welcome to PriceBoost!
                  </Text>
                  <Text as="p" tone="inherit">
                    You're all set up with the free plan. Start by modifying some product prices to see how it works.
                  </Text>
                  <div>
                    <Link to="/app/pricing">
                      <Button size="large" tone="success">
                        🚀 Start Modifying Prices
                      </Button>
                    </Link>
                  </div>
                  <Text as="p" variant="bodySm" tone="inherit">
                    ✨ You can modify up to {subscription.usageLimit.toLocaleString()} unique products per month on the free plan.
                  </Text>
                </BlockStack>
              </div>
            </Card>
          </Layout.Section>
        )}

        {/* Upgrade CTA for free plan */}
        {plan.name === "free" && !hasReachedLimit && !isNewUser && !billingStatus && !syncStatus && (
          <Layout.Section>
            <Card>
              <div style={{ 
                padding: "2rem", 
                textAlign: "center",
                background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
                color: "white",
                borderRadius: "8px"
              }}>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingLg" tone="inherit">
                    Ready to modify more products?
                  </Text>
                  <Text as="p" tone="inherit">
                    Upgrade to Standard ({PLANS.standard.usageLimit.toLocaleString()} products/month) with advanced features and 7-day free trial.
                  </Text>
                  <div>
                    <Link to="/app/billing">
                      <Button size="large" tone="success">
                        🚀 View Pricing Plans
                      </Button>
                    </Link>
                  </div>
                  <Text as="p" variant="bodySm" tone="inherit">
                    ✨ After upgrading, return here and your new plan will be automatically activated!
                  </Text>
                </BlockStack>
              </div>
            </Card>
          </Layout.Section>
        )}

        {/* Advanced usage insights */}
        {!isNewUser && subscription.usageCount > 5 && (
          <Layout.Section>
            <Card>
              <div style={{ padding: "1.5rem" }}>
                <BlockStack gap="400">
                  <Text as="h3" variant="headingMd">📊 Your Usage Insights</Text>
                  
                  <div style={{ 
                    display: "grid", 
                    gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", 
                    gap: "1rem" 
                  }}>
                    <div>
                      <Text as="p" variant="bodyMd" fontWeight="semibold">
                        {isUnlimited ? "∞" : `${usagePercentage.toFixed(1)}%`}
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        {isUnlimited ? "unlimited plan" : "of monthly quota used"}
                      </Text>
                    </div>
                    
                    <div>
                      <Text as="p" variant="bodyMd" fontWeight="semibold">
                        {subscription.totalPriceChanges ? Math.round(subscription.totalPriceChanges / subscription.usageCount) : 0}
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        avg. changes per product
                      </Text>
                    </div>
                    
                    <div>
                      <Text as="p" variant="bodyMd" fontWeight="semibold">
                        {plan.displayName}
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        current plan
                      </Text>
                    </div>
                  </div>
                  
                  {plan.name === "free" && subscription.usageCount > 15 && (
                    <div style={{ 
                      padding: "1rem", 
                      backgroundColor: "#f6f6f7", 
                      borderRadius: "8px",
                      border: "1px solid #e1e3e5"
                    }}>
                      <Text as="p" variant="bodySm">
                        💡 <strong>Pro Tip:</strong> You're using your free plan efficiently! 
                        Consider upgrading to {PLANS.standard.usageLimit.toLocaleString()} products with a 7-day free trial.
                      </Text>
                    </div>
                  )}
                </BlockStack>
              </div>
            </Card>
          </Layout.Section>
        )}
      </Layout>
    </Page>
  );
}