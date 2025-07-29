import { json, LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { useLoaderData, Form, useActionData, useNavigation } from "@remix-run/react";
import { authenticate } from "../shopify.server";
import { 
  Card, 
  Layout, 
  Page, 
  Button, 
  Banner, 
  Text, 
  Grid, 
  Badge,
  ProgressBar,
  Icon,
  BlockStack,
  InlineStack,
  Divider,
  List,
  Box,
} from "@shopify/polaris";
import {
  PlanIcon,
} from "@shopify/polaris-icons";
import { getSubscriptionStats, updateSubscription } from "../models/subscription.server";
import { PLANS, getPlan, formatPriceDisplay } from "../lib/plans";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  
  const subscriptionStats = await getSubscriptionStats(session.shop);
  
  return json({ 
    subscriptionStats,
    plans: Object.values(PLANS),
    shop: session.shop,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const planName = formData.get("planName") as string;
  
  const selectedPlan = PLANS[planName];
  
  if (!selectedPlan || selectedPlan.name === "free") {
    return json({ error: "Invalid plan selected" });
  }

  // Development mode: Simulate upgrade without Shopify Billing API
if (process.env.NODE_ENV === "development") {
  try {
    await updateSubscription(session.shop, {
      planName: selectedPlan.name,
      status: "active",
      usageLimit: selectedPlan.usageLimit,
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });
    
    return json({ 
      success: true,
      message: `Successfully upgraded to ${selectedPlan.displayName}!`,
      redirectToApp: true
    });
  } catch (error: any) {
    return json({ 
      error: "Error during simulated upgrade",
      details: error.message 
    });
  }
}
 // Production mode: Use Shopify API
 try {
  const response = await admin.graphql(`
    mutation AppSubscriptionCreate($name: String!, $returnUrl: URL!, $test: Boolean, $lineItems: [AppSubscriptionLineItemInput!]!) {
      appSubscriptionCreate(name: $name, returnUrl: $returnUrl, test: $test, lineItems: $lineItems) {
        appSubscription {
          id
          name
          status
          currentPeriodEnd
          test
        }
        confirmationUrl
        userErrors {
          field
          message
        }
      }
    }
  `, {
    variables: {
      name: `Dynamic Pricing ${selectedPlan.displayName}`,
      returnUrl: `${process.env.SHOPIFY_APP_URL}/app/billing/callback`,
      test: process.env.NODE_ENV !== "production", // true pour test, false pour prod
      lineItems: [{
        plan: {
          appRecurringPricingDetails: {
            interval: selectedPlan.billingInterval || "EVERY_30_DAYS",
            price: { 
              amount: selectedPlan.price.toString(), // Convertir en string
              currencyCode: selectedPlan.currency
            }
          }
        }
      }]
    }
  });
  
  const data = await response.json();
  
  console.log("📊 Subscription creation response:", JSON.stringify(data, null, 2));
  
  if (data.data?.appSubscriptionCreate?.userErrors?.length > 0) {
    console.error("❌ Subscription errors:", data.data.appSubscriptionCreate.userErrors);
    return json({ 
      error: "Subscription creation failed",
      details: data.data.appSubscriptionCreate.userErrors 
    });
  }
  
  if (data.data?.appSubscriptionCreate?.confirmationUrl) {
    // Store pending subscription info
    await updateSubscription(session.shop, {
      status: "pending",
      planName: selectedPlan.name,
    });
    
    console.log("✅ Subscription created, redirecting to:", data.data.appSubscriptionCreate.confirmationUrl);
    
    return json({ 
      confirmationUrl: data.data.appSubscriptionCreate.confirmationUrl 
    });
  }
  
  return json({ error: "Unable to create subscription" });
  
} catch (error: any) {
  console.error("💥 Billing error:", error);
  return json({ 
    error: "System error during subscription creation",
    details: error.message 
  });
}
};

export default function Billing() {
  const { subscriptionStats, plans, shop } = useLoaderData<typeof loader>();
  const actionData = useActionData<any>();
  const navigation = useNavigation();
  
  const isLoading = navigation.state === "submitting";
  
  // Redirect to Shopify billing if confirmation URL is provided
  if (actionData?.confirmationUrl && typeof window !== "undefined") {
    window.parent.location.href = actionData.confirmationUrl;
    return (
      <Page title="Redirecting to Shopify...">
        <Layout>
          <Layout.Section>
            <Card>
              <div style={{ padding: "2rem", textAlign: "center" }}>
                <Text as="p">Redirecting to Shopify billing page...</Text>
              </div>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  // Handle successful simulated upgrade
  if (actionData?.success && actionData?.redirectToApp) {
    return (
      <Page title="Upgrade Successful!">
        <Layout>
          <Layout.Section>
            <Banner tone="success" title="Upgrade Completed Successfully!">
              <Text as="p">{actionData.message}</Text>
            </Banner>
            <div style={{ marginTop: "1rem", textAlign: "center" }}>
              <Button variant="primary" url="/app">
                Return to Dashboard
              </Button>
            </div>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  const getBadgeStatus = (currentPlan: string, planName: string) => {
    if (currentPlan === planName) {
      return <Badge tone="success">Current Plan</Badge>;
    }
    if (planName === "standard" && PLANS[planName].recommended) {
      return <Badge tone="attention">⭐ Recommended</Badge>;
    }
    return null;
  };

  const getButtonState = (planName: string) => {
    if (subscriptionStats.planName === planName) {
      return { disabled: true, text: "Current Plan", tone: undefined };
    }
    if (planName === "free") {
      return { disabled: true, text: "Contact Support", tone: undefined };
    }
    return { 
      disabled: false, 
      text: `Upgrade to ${PLANS[planName].displayName}`, 
      tone: "primary" as const
    };
  };

  return (
    <Page 
      title="Subscription & Billing"
      subtitle={`Manage your Dynamic Pricing subscription for ${shop}`}
      backAction={{ content: "← Dashboard", url: "/app" }}
    >
      <Layout>
        {/* Current Subscription Overview */}
        <Layout.Section>
          <Card>
            <div style={{ padding: "2rem" }}>
              <Grid>
                <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 4, lg: 8, xl: 8 }}>
                  <BlockStack gap="400">
                    <div>
                      <InlineStack gap="200" align="start">
                        <Icon source={PlanIcon} />
                        <div>
                          <Text as="h2" variant="headingLg">
                            {subscriptionStats.plan.displayName} Plan
                          </Text>
                          <Text as="p" variant="bodyLg" tone="subdued">
                            {formatPriceDisplay(subscriptionStats.plan.price)}
                          </Text>
                        </div>
                      </InlineStack>
                    </div>
                    
                    <div>
                      <Text as="h3" variant="headingMd">
                        Usage This Month
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        {subscriptionStats.usageCount} of {subscriptionStats.usageLimit} modifications used
                      </Text>
                      <div style={{ marginTop: "0.5rem" }}>
                        <ProgressBar 
                          progress={subscriptionStats.usagePercentage} 
                          size="medium"
                          tone={subscriptionStats.usagePercentage >= 100 ? "critical" : "primary"}
                        />
                      </div>
                    </div>
                  </BlockStack>
                </Grid.Cell>
                
                <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 4, lg: 4, xl: 4 }}>
                  <div style={{ 
                    padding: "1.5rem", 
                    backgroundColor: "#f8f9fa", 
                    borderRadius: "8px",
                    textAlign: "center"
                  }}>
                    <div style={{ marginBottom: "1rem" }}>
                    <Text as="h3" variant="headingMd" >
                      Account Status
                    </Text>
                    </div>
                    <Badge 
                      tone={subscriptionStats.usagePercentage >= 100 ? "critical" : "success"}
                      size="large"
                    >
                      {subscriptionStats.usagePercentage >= 100 ? "❌ Limit Reached" : "✅ Active"}
                    </Badge>
                    <div style={{ marginTop: "0.5rem" }}>
                      <Text as="p" variant="bodySm" tone="subdued">
                        Next billing: {new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toLocaleDateString()}
                      </Text>
                    </div>
                  </div>
                </Grid.Cell>
              </Grid>
            </div>
          </Card>
        </Layout.Section>

        {/* Usage Warnings */}
        {subscriptionStats.usagePercentage > 80 && subscriptionStats.planName === 'free' && (
          <Layout.Section>
            <Banner 
              tone="warning" 
              title="Usage Limit Warning"
              action={{ content: "Upgrade Now", url: "#plans" }}
            >
              <Text as="p">
                You've used {subscriptionStats.usagePercentage.toFixed(1)}% of your monthly quota. 
                Consider upgrading to continue using the app without interruption.
              </Text>
            </Banner>
          </Layout.Section>
        )}

        {subscriptionStats.usagePercentage >= 100 && (
          <Layout.Section>
            <Banner 
              tone="critical" 
              title="Usage Limit Reached"
              action={{ content: "Upgrade Now", url: "#plans" }}
            >
              <Text as="p">
                You've reached your monthly limit of {subscriptionStats.usageLimit} modifications. 
                Upgrade your plan to continue making price changes.
              </Text>
            </Banner>
          </Layout.Section>
        )}

        {/* Error Display */}
        {actionData?.error && (
          <Layout.Section>
            <Banner tone="critical" title="Subscription Error">
              <Text as="p">{actionData.error}</Text>
              {actionData.details && (
                <div style={{ marginBottom: "0.5rem" }}>
                <Text as="p" variant="bodySm">
                  Details: {JSON.stringify(actionData.details)}
                </Text>
                </div>
              )}
            </Banner>
          </Layout.Section>
        )}
        
        {/* Available Plans */}
        <Layout.Section>
          <div id="plans">
            <BlockStack gap="400">
              <div style={{ textAlign: "center", marginBottom: "2rem" }}>
                <Text as="h2" variant="heading2xl">Choose Your Plan</Text>
                <Text as="p" variant="bodyLg" tone="subdued">
                  Select the perfect plan for your business needs
                </Text>
              </div>
              
              <Grid>
                {plans.map((plan) => {
                  const buttonState = getButtonState(plan.name);
                  const isCurrentPlan = subscriptionStats.planName === plan.name;
                  
                  return (
                    <Grid.Cell key={plan.name} columnSpan={{ xs: 6, sm: 6, md: 4, lg: 4, xl: 4 }}>
                      <Card>
                        <div style={{ 
                          padding: "2rem", 
                          height: "100%",
                          display: "flex",
                          flexDirection: "column",
                          border: isCurrentPlan ? "2px solid #008060" : plan.recommended ? "2px solid #ffa500" : "1px solid #e1e3e5",
                          borderRadius: "8px",
                          position: "relative"
                        }}>
                          {/* Plan Badge */}
                          <div style={{ marginBottom: "1rem", minHeight: "32px" }}>
                            {getBadgeStatus(subscriptionStats.planName, plan.name)}
                          </div>
                          
                          {/* Plan Header */}
                          <div style={{ marginBottom: "1.5rem", textAlign: "center" }}>
                            <Text as="h3" variant="headingLg">{plan.displayName}</Text>
                            <div style={{ margin: "0.5rem 0" }}>
                              <Text as="span" variant="heading2xl">
                                {formatPriceDisplay(plan.price, plan.currency)}
                              </Text>
                            </div>
                            <Text as="p" variant="bodySm" tone="subdued">
                              {plan.usageLimit === 99999 ? "Unlimited" : `${plan.usageLimit}`} modifications/month
                            </Text>
                          </div>
                          
                          <Divider />
                          
                          {/* Features List */}
                          <div style={{ margin: "1.5rem 0", flex: 1 }}>
                            <List type="bullet">
                              {plan.features.map((feature, index) => (
                                <List.Item key={index}>
                                  <Text as="span" variant="bodySm">{feature}</Text>
                                </List.Item>
                              ))}
                            </List>
                          </div>
                          
                          {/* Action Button */}
                          <div style={{ marginTop: "auto" }}>
                            {isCurrentPlan ? (
                              <Button 
                                disabled 
                                fullWidth 
                                size="large"
                              >
                                Current Plan
                              </Button>
                            ) : plan.name === "free" ? (
                              <Button 
                                disabled 
                                fullWidth 
                                size="large"
                              >
                                Contact Support to Downgrade
                              </Button>
                            ) : (
                              <Form method="post">
                                <input type="hidden" name="planName" value={plan.name} />
                                <Button 
                                  submit 
                                  variant="primary" 
                                  fullWidth 
                                  size="large"
                                  loading={isLoading}
                                >
                                  {isLoading ? "Processing..." : buttonState.text}
                                </Button>
                              </Form>
                            )}
                          </div>
                        </div>
                      </Card>
                    </Grid.Cell>
                  );
                })}
              </Grid>
            </BlockStack>
          </div>
        </Layout.Section>

        {/* Billing Information */}
        <Layout.Section>
          <Card>
            <div style={{ padding: "2rem" }}>
              <BlockStack gap="400">
                <InlineStack gap="200">
                  <Text as="h3" variant="headingLg">💳 Billing Information</Text>
                </InlineStack>
                
                <Grid>
                  <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 4, lg: 6, xl: 6 }}>
                    <BlockStack gap="200">
                      <Text as="h4" variant="headingMd">Payment & Security</Text>
                      <List type="bullet">
                        <List.Item>All payments are processed securely through Shopify</List.Item>
                        <List.Item>Prices shown in USD, converted to your local currency</List.Item>
                        <List.Item>SSL encrypted transactions for maximum security</List.Item>
                        <List.Item>PCI DSS compliant payment processing</List.Item>
                      </List>
                    </BlockStack>
                  </Grid.Cell>
                  
                  <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 4, lg: 6, xl: 6 }}>
                    <BlockStack gap="200">
                      <Text as="h4" variant="headingMd">Subscription Details</Text>
                      <List type="bullet">
                        <List.Item>Usage resets monthly on your billing anniversary</List.Item>
                        <List.Item>Cancel anytime from your Shopify admin panel</List.Item>
                        <List.Item>Instant plan upgrades, prorated billing</List.Item>
                        <List.Item>24/7 customer support for paid plans</List.Item>
                      </List>
                    </BlockStack>
                  </Grid.Cell>
                </Grid>
                
                <Divider />
                
                <div style={{ textAlign: "center" }}>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Questions about billing? Contact our support team at{" "}
                    <Text as="span" fontWeight="semibold">support@dynamicpricing.app</Text>
                  </Text>
                </div>
              </BlockStack>
            </div>
          </Card>
        </Layout.Section>

        {/* FAQ Section */}
        <Layout.Section>
          <Card>
            <div style={{ padding: "2rem" }}>
              <BlockStack gap="400">
                <div style={{ textAlign: "center" }}>
                  <Text as="h3" variant="headingLg">Frequently Asked Questions</Text>
                </div>
                
                <Grid>
                  <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 4, lg: 6, xl: 6 }}>
                    <BlockStack gap="300">
                      <div>
                        <Text as="h4" variant="headingMd">Can I change plans anytime?</Text>
                        <Text as="p" variant="bodySm" tone="subdued">
                          Yes! You can upgrade or downgrade your plan at any time. 
                          Upgrades are instant, and you'll be charged prorated amounts.
                        </Text>
                      </div>
                      
                      <div>
                        <Text as="h4" variant="headingMd">What happens if I exceed my limit?</Text>
                        <Text as="p" variant="bodySm" tone="subdued">
                          You'll receive warnings at 80% usage. At 100%, you'll need to 
                          upgrade to continue making price modifications.
                        </Text>
                      </div>
                    </BlockStack>
                  </Grid.Cell>
                  
                  <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 4, lg: 6, xl: 6 }}>
                    <BlockStack gap="300">
                      <div>
                        <Text as="h4" variant="headingMd">Is there a free trial?</Text>
                        <Text as="p" variant="bodySm" tone="subdued">
                          Yes! Every new installation includes our Free plan with 20 
                          modifications per month to get you started.
                        </Text>
                      </div>
                      
                      <div>
                        <Text as="h4" variant="headingMd">How secure is my data?</Text>
                        <Text as="p" variant="bodySm" tone="subdued">
                          We use Shopify's secure infrastructure and never store your 
                          product data permanently. All changes are made directly via Shopify's API.
                        </Text>
                      </div>
                    </BlockStack>
                  </Grid.Cell>
                </Grid>
              </BlockStack>
            </div>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}