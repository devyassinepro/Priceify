// app/routes/app._index.tsx - Updated dashboard for product-based quota

import { json, LoaderFunctionArgs } from "@remix-run/node";
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
  const { session } = await authenticate.admin(request);
  const subscriptionStats = await getSubscriptionStats(session.shop);
  const plan = getPlan(subscriptionStats.planName);

   // Check for upgrade success parameter
   const url = new URL(request.url);
   const upgraded = url.searchParams.get("upgraded") === "true";
  
   return json({
    shop: session.shop,
    subscription: subscriptionStats,
    plan,
    usagePercentage: (subscriptionStats.usageCount / subscriptionStats.usageLimit) * 100,
    remainingProducts: subscriptionStats.usageLimit - subscriptionStats.usageCount,
    uniqueProductCount: subscriptionStats.uniqueProductCount || 0,
    showUpgradeSuccess: upgraded,
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
    showUpgradeSuccess 
  } = useLoaderData<typeof loader>();

  const isNewUser = subscription.usageCount === 0;
  const isNearLimit = usagePercentage > 80;
  const hasReachedLimit = usagePercentage >= 100;

  return (
    <Page title="Dashboard" subtitle={`Welcome back to Dynamic Pricing for ${shop}`}>
      <Layout>
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

        {/* Welcome/Status Banner */}
        {isNewUser && !showUpgradeSuccess ? (
          <Layout.Section>
            <Banner title="Welcome to Dynamic Pricing!" tone="success">
              <Text as="p">
                Your app is successfully installed! Start by updating your first product prices. 
                Remember: your quota is based on unique products modified, not individual price changes.
              </Text>
            </Banner>
          </Layout.Section>
        ) : isNearLimit && !showUpgradeSuccess ? (
          <Layout.Section>
            <Banner 
              title={hasReachedLimit ? "Product Limit Reached" : "Approaching Product Limit"}
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
                You've modified {subscription.usageCount} of {subscription.usageLimit} allowed unique products this month
                {hasReachedLimit ? ". Upgrade to continue making changes." : "."}
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

                      {plan.name === "free" && (
                        <Link to="/app/billing">
                          <Button size="large" tone="success">
                            Upgrade Plan
                          </Button>
                        </Link>
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

        {/* Upgrade CTA for Free Users - Updated messaging */}
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
                    Upgrade to modify up to 500 unique products per month (Standard) or unlimited products (Pro)
                  </Text>
                  <div>
                    <Link to="/app/billing">
                      <Button size="large">
                        View Upgrade Options
                      </Button>
                    </Link>
                  </div>
                </BlockStack>
              </div>
            </Card>
          </Layout.Section>
        )}
      </Layout>
    </Page>
  );
}