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
} from "@shopify/polaris";
import {
  PriceListIcon,
  ChartVerticalIcon,
  CheckCircleIcon,
  PlanIcon,
} from "@shopify/polaris-icons";
import { getOrCreateSubscription } from "../models/subscription.server";
import { getPlan, formatPriceDisplay } from "../lib/plans";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const subscription = await getOrCreateSubscription(session.shop);
  const plan = getPlan(subscription.planName);
  
  return json({
    shop: session.shop,
    subscription,
    plan,
    usagePercentage: (subscription.usageCount / subscription.usageLimit) * 100,
    remainingUsage: subscription.usageLimit - subscription.usageCount,
  });
};

export default function Index() {
  const { shop, subscription, plan, usagePercentage, remainingUsage } = useLoaderData<typeof loader>();

  const isNewUser = subscription.usageCount === 0;
  const isNearLimit = usagePercentage > 80;
  const hasReachedLimit = usagePercentage >= 100;

  return (
    <Page title="Dashboard" subtitle={`Welcome back to Dynamic Pricing for ${shop}`}>
      <Layout>
        {/* Welcome/Status Banner */}
        {isNewUser ? (
          <Layout.Section>
            <Banner title="Welcome to Dynamic Pricing!" tone="success">
              <Text as="p">
                Your app is successfully installed! Start by updating your first product prices.
              </Text>
            </Banner>
          </Layout.Section>
        ) : isNearLimit ? (
          <Layout.Section>
            <Banner 
              title={hasReachedLimit ? "Usage Limit Reached" : "Approaching Usage Limit"}
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
                You've used {subscription.usageCount} of {subscription.usageLimit} monthly modifications
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
                  <Text as="h3" variant="headingMd">Usage This Month</Text>
                  <Text as="p" variant="bodyLg">
                    {subscription.usageCount} / {subscription.usageLimit}
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
                  <Text as="h3" variant="headingMd">Remaining</Text>
                  <Text as="p" variant="bodyLg" tone={remainingUsage > 0 ? "success" : "critical"}>
                    {remainingUsage} modifications
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
                  <Text as="h3" variant="headingMd">Status</Text>
                  <Badge tone={hasReachedLimit ? "critical" : "success"}>
                    {hasReachedLimit ? "Limit Reached" : "Active"}
                  </Badge>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Account status
                  </Text>
                </div>
              </Card>
            </Grid.Cell>
          </Grid>
        </Layout.Section>

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
                        Use our intelligent pricing tools to boost your revenue and stay competitive
                      </Text>
                    </div>
                    
                    <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
                      <Link to="/app/pricing">
                        <Button 
                          variant="primary" 
                          size="large"
                          disabled={hasReachedLimit}
                        >
                          Update Prices
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
                        <strong>1. Select</strong> products to modify
                      </Text>
                      <Text as="p" variant="bodySm">
                        <strong>2. Choose</strong> adjustment type (%, fixed price, etc.)
                      </Text>
                      <Text as="p" variant="bodySm">
                        <strong>3. Preview</strong> changes before applying
                      </Text>
                      <Text as="p" variant="bodySm">
                        <strong>4. Apply</strong> updates to your store
                      </Text>
                    </div>
                  </BlockStack>
                </div>
              </Card>
            </Grid.Cell>
          </Grid>
        </Layout.Section>

        {/* Feature Highlights */}
        <Layout.Section>
          <Card>
            <div style={{ padding: "2rem" }}>
              <BlockStack gap="400">
                <Text as="h2" variant="headingLg">Pricing Features</Text>
                
                <Grid>
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
                        <Text as="h3" variant="headingMd">Smart Filters</Text>
                      </div>
                      <Text as="p" variant="bodySm" tone="subdued">
                        Filter products by status, price range, vendor, or search by name to target specific items
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

        {/* Upgrade CTA for Free Users */}
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
                    Ready for more powerful pricing?
                  </Text>
                  <Text as="p" tone="inherit">
                    Unlock unlimited modifications, advanced filters, and priority support
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
