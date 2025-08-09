// app/routes/app._index.tsx - Updated dashboard for product-based quota

import { json, LoaderFunctionArgs , redirect } from "@remix-run/node";
import { useLoaderData, Link } from "@remix-run/react";
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
  Badge,
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
import { getPlan, formatPriceDisplay } from "../lib/plans";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);


  // ✅ Handle billing callback when charge_id is present
  const url = new URL(request.url);
  const charge_id = url.searchParams.get("charge_id");
  
  if (charge_id) {
    console.log(`🔄 =================BILLING CALLBACK DETECTED================`);
    console.log(`⏰ Timestamp: ${new Date().toISOString()}`);
    console.log(`🏪 Shop: ${session.shop}`);
    console.log(`💳 Charge ID: ${charge_id}`);
    console.log(`🔗 Full URL: ${url.toString()}`);
    
    try {
      // Import functions dynamically to avoid circular dependencies
      const { updateSubscription } = await import("../models/subscription.server");
      const { PLANS } = await import("../lib/plans");
      
      // Get subscription details from Shopify
      console.log(`🔍 Fetching subscription details for charge: ${charge_id}`);
      
      const response = await admin.graphql(`
        query GetAppSubscription($id: ID!) {
          node(id: $id) {
            ... on AppSubscription {
              id
              name
              status
              currentPeriodEnd
              test
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
        }
      `, {
        variables: { id: `gid://shopify/AppSubscription/${charge_id}` }
      });

      const data = await response.json();
      console.log(`📊 Shopify subscription response:`, JSON.stringify(data, null, 2));
      
      // Check for errors
      if (data && typeof data === 'object' && 'errors' in data && data.errors) {
        console.error(`❌ GraphQL errors:`, data.errors);
        return redirect("/app?billing_error=graphql_error");
      }
      
      const subscription = data.data?.node;
      
      if (!subscription) {
        console.error(`❌ No subscription found for charge: ${charge_id}`);
        return redirect("/app?billing_error=subscription_not_found");
      }
      
      console.log(`📋 Subscription status: ${subscription.status}`);
      
      if (subscription.status === "ACTIVE") {
        // Extract pricing information
        const amount = subscription.lineItems?.[0]?.plan?.pricingDetails?.price?.amount;
        console.log(`💰 Subscription amount: ${amount}`);
        
        // Determine plan based on price
        let planName = "free";
        if (amount) {
          const priceFloat = parseFloat(amount);
          console.log(`🔍 Matching price: ${priceFloat}`);
          
          // Simple and reliable price matching
          if (Math.abs(priceFloat - 4.99) < 0.02) {
            planName = "standard";
          } else if (Math.abs(priceFloat - 9.99) < 0.02) {
            planName = "pro";
          }
          
          console.log(`✅ Matched plan: ${planName} for price $${priceFloat}`);
        }
        
        // Update local subscription
        console.log(`🔄 Updating local subscription for ${session.shop}: ${planName}`);
        
        await updateSubscription(session.shop, {
          planName,
          status: "active",
          subscriptionId: charge_id,
          usageLimit: PLANS[planName].usageLimit,
          currentPeriodEnd: subscription.currentPeriodEnd ? new Date(subscription.currentPeriodEnd) : undefined,
        });
        
        console.log(`✅ Local subscription updated successfully!`);
        console.log(`🚀 =================BILLING CALLBACK SUCCESS==================`);
        
        // Redirect to clean URL with success flag
        return redirect("/app?upgraded=true");
        
      } else {
        console.error(`❌ Subscription not active: ${subscription.status}`);
        return redirect("/app?billing_error=subscription_inactive");
      }
      
    } catch (error: any) {
      console.error(`💥 =================BILLING CALLBACK ERROR===============`);
      console.error(`❌ Error processing billing callback:`, error);
      console.error(`💥 =======================================================`);
      return redirect("/app?billing_error=processing_failed");
    }
  }


  // ✅ Continue with your existing loader logic
  const subscriptionStats = await getSubscriptionStats(session.shop);
  const plan = getPlan(subscriptionStats.planName);

  // Check for upgrade success parameter
  const upgraded = url.searchParams.get("upgraded") === "true";
  const billing_error = url.searchParams.get("billing_error");
  
  return json({
    shop: session.shop,
    subscription: subscriptionStats,
    plan,
    usagePercentage: (subscriptionStats.usageCount / subscriptionStats.usageLimit) * 100,
    remainingProducts: subscriptionStats.usageLimit - subscriptionStats.usageCount,
    uniqueProductCount: subscriptionStats.uniqueProductCount || 0,
    showUpgradeSuccess: upgraded,
    billingError: billing_error,
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
    showUpgradeSuccess,
    billingError 
  } = useLoaderData<typeof loader>();

  const isNewUser = subscription.usageCount === 0;
  const isNearLimit = usagePercentage > 80;
  const hasReachedLimit = usagePercentage >= 100;

  // ✅ Direct Shopify pricing plans URL
  const shopName = shop.replace('.myshopify.com', '');
  const shopifyBillingUrl = `https://admin.shopify.com/store/${shopName}/charges/priceboost/pricing_plans`;

  return (
    <Page title="Dashboard" subtitle={`Welcome back to Dynamic Pricing for ${shop}`}>
      <Layout>
          {/* ✅ ADD: Billing Error Banner */}
            {billingError && (
          <Layout.Section>
            <Banner title="Billing Processing Issue" tone="critical">
              <Text as="p">
                {billingError === 'subscription_not_found' && "We couldn't find your subscription details. Please contact support."}
                {billingError === 'subscription_inactive' && "Your subscription is not yet active. Please try again in a few minutes."}
                {billingError === 'processing_failed' && "There was an error processing your subscription. Please contact support."}
                {billingError === 'graphql_error' && "Unable to verify your subscription with Shopify. Please contact support."}
              </Text>
            </Banner>
          </Layout.Section>
        )}
        {/* Upgrade Success Banner */}
        {showUpgradeSuccess && (
          <Layout.Section>
            <Banner title="🎉 Upgrade Successful!" tone="success">
              <Text as="p">
                Welcome to {plan.displayName}! You can now modify up to {plan.usageLimit === 99999 ? 'unlimited' : plan.usageLimit} products per month.
              </Text>
            </Banner>
          </Layout.Section>
        )}

        {/* ✅ UPDATE: Usage warnings with direct Shopify links */}
        {isNearLimit && !showUpgradeSuccess ? (
          <Layout.Section>
            <Banner 
              title={hasReachedLimit ? "Product Limit Reached" : "Approaching Product Limit"}
              tone={hasReachedLimit ? "critical" : "warning"}
              action={hasReachedLimit ? {
                content: "View Pricing Plans",
                url: shopifyBillingUrl,
                external: true
              } : {
                content: "View Pricing Plans",
                url: shopifyBillingUrl,
                external: true
              }}
            >
              <Text as="p">
                You've modified {subscription.usageCount} of {subscription.usageLimit} allowed unique products this month
                {hasReachedLimit ? ". Upgrade in Shopify to continue making changes." : "."}
              </Text>
            </Banner>
          </Layout.Section>
        ) : null}

        {/* Quick Stats Grid */}
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
                    {subscription.usageCount} / {subscription.usageLimit}
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Unique products this month
                  </Text>
                  <div style={{ marginTop: "0.5rem" }}>
                    <ProgressBar 
                      progress={usagePercentage} 
                      size="small"
                      tone={hasReachedLimit ? "critical" : "primary"}
                    />
                  </div>
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
                  <Text as="p" variant="bodyLg" tone={remainingProducts > 0 ? "success" : "critical"}>
                    {remainingProducts}
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    until {new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toLocaleDateString()}
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
                    {subscription.totalPriceChanges || 0}
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Individual changes made
                  </Text>
                </div>
              </Card>
            </Grid.Cell>
          </Grid>
        </Layout.Section>

        {/* Quota Explanation
        <Layout.Section>
          <Card>
            <div style={{ padding: "1.5rem", backgroundColor: "#f6f6f7", borderRadius: "8px" }}>
              <BlockStack gap="300">
                <InlineStack align="space-between">
                  <Text as="h3" variant="headingMd">🎯 How Your Quota Works</Text>
                  <Badge tone="info">NEW: Product-Based Quota</Badge>
                </InlineStack>
                
                <Grid>
                  <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 4, lg: 4, xl: 4 }}>
                    <div style={{ textAlign: "center", padding: "1rem" }}>
                      <Text as="h4" variant="headingMd" tone="success">✅ Counts Toward Quota</Text>
                      <Text as="p" variant="bodySm">
                        Each unique product you modify counts as 1 toward your monthly limit
                      </Text>
                    </div>
                  </Grid.Cell>
                  
                  <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 4, lg: 4, xl: 4 }}>
                    <div style={{ textAlign: "center", padding: "1rem" }}>
                      <Text as="h4" variant="headingMd" tone="subdued">🔄 Free Within Product</Text>
                      <Text as="p" variant="bodySm">
                        Multiple price changes to the same product (variants, repeated updates) don't count extra
                      </Text>
                    </div>
                  </Grid.Cell>
                  
                  <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 4, lg: 4, xl: 4 }}>
                    <div style={{ textAlign: "center", padding: "1rem" }}>
                      <Text as="h4" variant="headingMd" tone="caution">📊 Example</Text>
                      <Text as="p" variant="bodySm">
                        Update 5 variants of Product A + 3 variants of Product B = 2 products used from quota
                      </Text>
                    </div>
                  </Grid.Cell>
                </Grid>
              </BlockStack>
            </div>
          </Card>
        </Layout.Section> */}

        {/* Main Actions */}
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
                        <Button 
                          variant="primary" 
                          size="large"
                          disabled={hasReachedLimit}
                        >
                          {hasReachedLimit ? "Upgrade to Continue" : "Update Prices"}
                        </Button>
                      </Link>
                      
                      <Link to="/app/history">
                        <Button size="large">
                          View History
                        </Button>
                      </Link>

                      {/* ✅ UPDATED: Direct Shopify billing link */}
                      {plan.name === "free" && (
                        <Button 
                          size="large" 
                          tone="success"
                          url={shopifyBillingUrl}
                          external
                        >
                          🚀 View Pricing Plans
                        </Button>
                      )}
                    </div>
                  </BlockStack>
                </div>
              </Card>
            </Grid.Cell>
            
            <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 4, lg: 4, xl: 4 }}>
              <Card>
                <div style={{ padding: "1.5rem" }}>
                  <BlockStack gap="300">
                    <Text as="h3" variant="headingMd">Quick Guide</Text>
                    
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
                    </div>
                  </BlockStack>
                </div>
              </Card>
            </Grid.Cell>
          </Grid>
        </Layout.Section>

        {/* Feature Highlights - Updated */}
        <Layout.Section>
          <Card>
            <div style={{ padding: "2rem" }}>
              <BlockStack gap="400">
                <Text as="h2" variant="headingLg">Pricing Features</Text>
                
                <Grid>
                  <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 4, lg: 4, xl: 4 }}>
                    <div style={{ textAlign: "center", padding: "1rem" }}>
                      <div style={{ marginBottom: "1rem" }}>
                        <Text as="h3" variant="headingMd">Smart Product Quota</Text>
                      </div>
                      <Text as="p" variant="bodySm" tone="subdued">
                        Count unique products, not individual price changes. Modify all variants of a product for the cost of one quota unit
                      </Text>
                    </div>
                  </Grid.Cell>
                  
                  <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 4, lg: 4, xl: 4 }}>
                    <div style={{ textAlign: "center", padding: "1rem" }}>
                      <div style={{ marginBottom: "1rem" }}>
                        <Text as="h3" variant="headingMd">Bulk Updates</Text>
                      </div>
                      <Text as="p" variant="bodySm" tone="subdued">
                        Update hundreds of products simultaneously with percentage, fixed amounts, or incremental changes
                      </Text>
                    </div>
                  </Grid.Cell>
                  
                  <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 4, lg: 4, xl: 4 }}>
                    <div style={{ textAlign: "center", padding: "1rem" }}>
                      <div style={{ marginBottom: "1rem" }}>
                        <Text as="h3" variant="headingMd">Change History</Text>
                      </div>
                      <Text as="p" variant="bodySm" tone="subdued">
                        Track all pricing changes with detailed logs and easily revert modifications when needed
                      </Text>
                    </div>
                  </Grid.Cell>
                </Grid>
              </BlockStack>
            </div>
          </Card>
        </Layout.Section>

{/* ✅ UPDATE: Upgrade CTA with direct Shopify link */}
{plan.name === "free" && !hasReachedLimit && (
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
                    View our pricing plans to modify up to 500 unique products (Standard) or unlimited products (Pro)
                  </Text>
                  <div>
                    <Button 
                      size="large"
                      url={shopifyBillingUrl}
                      external
                    >
                      🔗 View Pricing Plans
                    </Button>
                  </div>
                  <Text as="p" variant="bodySm" tone="inherit">
                    ✨ After upgrading, return here and your new plan will be automatically activated!
                  </Text>
                </BlockStack>
              </div>
            </Card>
          </Layout.Section>
        )}
      </Layout>
    </Page>
  );
}