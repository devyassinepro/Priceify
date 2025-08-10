
import { json, LoaderFunctionArgs, ActionFunctionArgs,redirect } from "@remix-run/node";
import { useLoaderData, useActionData, Form } from "@remix-run/react";
import { authenticate } from "../shopify.server";
import {Card,Layout,Page,Text,Button,Grid,Badge,List,Banner,BlockStack} from "@shopify/polaris";
import { getOrCreateSubscription } from "../models/subscription.server";
import { PLANS } from "../lib/plans";
import { useEffect } from "react";
import { updateSubscription } from "../models/subscription.server";


interface ActionResult {
  success?: boolean;
  error?: string;
  confirmationUrl?: string;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const subscription = await getOrCreateSubscription(session.shop);  

  const isTestMode = process.env.SHOPIFY_BILLING_TEST === "true" || 
  process.env.NODE_ENV === "development" ||
  session.shop.includes("test-") ||
  session.shop.includes("dev-");
  
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");
  const planParam = url.searchParams.get("plan");
  const charge_id = url.searchParams.get("charge_id");
  
  console.log(`🔄 Billing callback received for shop: ${shop}, plan: ${planParam}`);
  console.log(`🔗 Full callback URL: ${url.toString()}`);
  
  // Check required parameters
  if (!shop) {
    console.error(`❌ No shop parameter in callback URL`);
    return redirect("/auth/login?error=missing_shop");
  }
  
  try {
    // Try to authenticate with the request
    const { admin, session } = await authenticate.admin(request);
    
    console.log(`✅ Authentication successful for ${session.shop}`);
    
    // Verify shop matches
    if (session.shop !== shop) {
      console.error(`❌ Shop mismatch: session=${session.shop}, callback=${shop}`);
      return redirect(`/auth/login?shop=${shop}`);
    }
    
    // Get active subscriptions from Shopify to verify the payment
    const response = await admin.graphql(`
      query GetActiveSubscriptions {
        app {
          installation {
            activeSubscriptions {
              id
              name
              status
              currentPeriodEnd
              createdAt
              lineItems {
                plan {
                  pricingDetails {
                    ... on AppRecurringPricing {
                      price {
                        amount
                        currencyCode
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    `);

    const data = await response.json();
    const activeSubscriptions = data.data?.app?.installation?.activeSubscriptions || [];
    
    console.log(`📊 Found ${activeSubscriptions.length} active subscriptions`);
    
    if (activeSubscriptions.length === 0) {
      console.error(`❌ No active subscriptions found after payment`);
      return redirect("/app?error=no_subscription_found");
    }
    
    // Get the most recent subscription
    const latestSubscription = activeSubscriptions.sort((a: any, b: any) => 
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )[0];
    
    if (latestSubscription.status !== "ACTIVE") {
      console.log(`⚠️ Subscription status: ${latestSubscription.status}`);
      return redirect("/app?error=subscription_not_active");
    }
    
    const amount = latestSubscription.lineItems?.[0]?.plan?.pricingDetails?.price?.amount;
    const subscriptionId = latestSubscription.id.split('/').pop();
    
    console.log(`💰 Processing subscription: ${subscriptionId}, amount: ${amount}`);
    
    // Determine plan based on price
    let planName = planParam || "free";
    if (amount) {
      const priceFloat = parseFloat(amount);
      for (const [key, plan] of Object.entries(PLANS)) {
        if (Math.abs(plan.price - priceFloat) < 0.02) {
          planName = key;
          console.log(`✅ Matched plan: ${planName} for price $${priceFloat}`);
          break;
        }
      }
    }
    
    // Update local subscription
    await updateSubscription(session.shop, {
      planName,
      status: "active",
      subscriptionId,
      usageLimit: PLANS[planName].usageLimit,
      currentPeriodEnd: latestSubscription.currentPeriodEnd ? 
        new Date(latestSubscription.currentPeriodEnd) : 
        new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });
    
    console.log(`✅ Subscription updated successfully: ${planName}`);
    
    // Redirect to app with success parameters
    return redirect(`/app?sync=success&plan=${planName}&upgraded=true`);
    
  } catch (authError: any) {
    console.log(`⚠️ Admin auth failed, trying alternative approach:`, authError.message);
    
    // If authentication fails, try to handle it gracefully
    if (authError.message?.includes('unauthorized') || authError.message?.includes('login')) {
      // Construct a safe redirect URL back to the app
      const redirectParams = new URLSearchParams();
      redirectParams.set('shop', shop);
      if (planParam) redirectParams.set('plan', planParam);
      if (charge_id) redirectParams.set('charge_id', charge_id);
      redirectParams.set('callback', 'billing');
      
      const safeRedirectUrl = `/app?${redirectParams.toString()}`;
      console.log(`🔄 Redirecting to app for re-authentication: ${safeRedirectUrl}`);
      
      return redirect(safeRedirectUrl);
    }
    
    // For other errors, redirect with error message
    console.error(`💥 Billing callback error:`, authError);
    return redirect(`/app?error=callback_failed&message=${encodeURIComponent(authError.message)}`);
  }
  return json({
    shop: session.shop,
    subscription,
    plans: Object.values(PLANS),
    isTestMode 
  });
};
export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);

  try {
    const formData = await request.formData();
    const selectedPlan = formData.get("plan") as string;
    
    if (!selectedPlan || !PLANS[selectedPlan]) {
      return json<ActionResult>({ error: "Invalid plan selected" });
    }
    
    const plan = PLANS[selectedPlan];
    
    if (plan.name === "free") {
      return json<ActionResult>({ error: "You're already on the free plan" });
    }
    
    console.log(`🔄 Creating billing charge for ${session.shop}: ${plan.displayName}`);
    
    // ✅ CORRECTION: URL de retour avec paramètres pour maintenir le contexte
    const baseUrl = process.env.SHOPIFY_APP_URL || `https://${request.headers.get('host')}`;
    const returnUrl = `${baseUrl}/app/billing/callback?shop=${session.shop}&plan=${plan.name}`;
    
    console.log(`📋 Return URL: ${returnUrl}`);
    
    const isTestMode = process.env.SHOPIFY_BILLING_TEST === "true" || 
                      process.env.NODE_ENV === "development" ||
                      session.shop.includes("test-") ||
                      session.shop.includes("dev-");
    
    console.log(`🧪 Test mode: ${isTestMode}`);
    
    const response = await admin.graphql(`
      mutation AppSubscriptionCreate($name: String!, $returnUrl: URL!, $test: Boolean, $lineItems: [AppSubscriptionLineItemInput!]!) {
        appSubscriptionCreate(name: $name, returnUrl: $returnUrl, test: $test, lineItems: $lineItems) {
          appSubscription {
            id
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
        name: plan.displayName,
        returnUrl: returnUrl, // ✅ URL avec paramètres
        test: isTestMode,
        lineItems: [
          {
            plan: {
              appRecurringPricingDetails: {
                price: { amount: plan.price, currencyCode: "USD" },
                interval: "EVERY_30_DAYS"
              }
            }
          }
        ]
      }
    });
    
    const result = await response.json();
    console.log(`📊 GraphQL response:`, JSON.stringify(result, null, 2));
    
    if (result.data?.appSubscriptionCreate?.userErrors?.length > 0) {
      const errors = result.data.appSubscriptionCreate.userErrors;
      console.error(`❌ Billing errors:`, errors);
      return json<ActionResult>({ 
        error: `Billing error: ${errors.map((e: any) => e.message).join(', ')}`
      });
    }
    
    const confirmationUrl = result.data?.appSubscriptionCreate?.confirmationUrl;
    
    if (!confirmationUrl) {
      console.error(`❌ No confirmation URL received`);
      return json<ActionResult>({ 
        error: "Failed to create subscription - no confirmation URL" 
      });
    }
    
    console.log(`✅ Billing charge created successfully`);
    console.log(`🔗 Confirmation URL: ${confirmationUrl}`);
    
    return json<ActionResult>({ 
      success: true, 
      confirmationUrl 
    });
    
  } catch (error: any) {
    console.error(`💥 Billing creation failed:`, error);
    return json<ActionResult>({ 
      error: `Failed to create subscription: ${error.message}` 
    });
  }
};


export default function Plans() {
  const { shop, subscription, plans,isTestMode } = useLoaderData<typeof loader>();
  const actionData = useActionData<ActionResult>();
  
  // ✅ REDIRECTION AUTOMATIQUE VERS SHOPIFY
  useEffect(() => {
    if (actionData?.success && actionData.confirmationUrl) {
      window.top!.location.href = actionData.confirmationUrl;
    }
  }, [actionData]);
  
  return (
    <Page title="Choose Your Plan" backAction={{ content: "← Dashboard", url: "/app" }}>
      <Layout>

          {/* ✅ Afficher un banner en mode test */}
          {isTestMode && (
          <Layout.Section>
            <Banner title="🧪 Test Mode Active" tone="info">
              <Text as="p">
                Billing is in test mode - no real charges will be made. 
                Perfect for testing your subscription flow!
              </Text>
            </Banner>
          </Layout.Section>
        )}
        {actionData?.error && (
          <Layout.Section>
            <Banner title="Subscription Error" tone="critical">
              <Text as="p">{actionData.error}</Text>
            </Banner>
          </Layout.Section>
        )}
        
        {actionData?.success && (
          <Layout.Section>
            <Banner title="🔄 Redirecting to Shopify..." tone="info">
              <Text as="p">Please wait while we redirect you to complete your subscription.</Text>
            </Banner>
          </Layout.Section>
        )}

        <Layout.Section>
          <Grid>
            {plans.map((plan) => (
              <Grid.Cell key={plan.name} columnSpan={{ xs: 6, sm: 6, md: 4, lg: 4, xl: 4 }}>
                <Card>
                  <div style={{ padding: "2rem", textAlign: "center", minHeight: "400px" }}>
                    <div style={{ marginBottom: "1rem" }}>
                      <Text as="h3" variant="headingLg">{plan.displayName}</Text>
                      {plan.recommended && <Badge tone="success">Most Popular</Badge>}
                    </div>
                    
                    <div style={{ marginBottom: "2rem" }}>
                      <Text as="p" variant="headingXl">
                        {plan.price === 0 ? "Free" : `$${plan.price}`}
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        {plan.price === 0 ? "Forever" : "per month"}
                      </Text>
                    </div>
                    
                    <div style={{ marginBottom: "2rem" }}>
                      <Text as="p" variant="bodyLg" fontWeight="semibold">
                        {plan.usageLimit === 99999 ? "Unlimited" : plan.usageLimit} products/month
                      </Text>
                    </div>
                    
                    <div style={{ textAlign: "left", marginBottom: "2rem" }}>
                      <List type="bullet">
                        {plan.features.slice(0, 4).map((feature, index) => (
                          <List.Item key={index}>
                            <Text as="span" variant="bodySm">{feature}</Text>
                          </List.Item>
                        ))}
                      </List>
                    </div>
                    
                    <div>
                      {subscription.planName === plan.name ? (
                        <Badge tone="success">Current Plan</Badge>
                      ) : (
                        <Form method="post">
                          <input type="hidden" name="plan" value={plan.name} />
                          <Button
                            submit
                            variant={plan.recommended ? "primary" : "secondary"}
                            size="large"
                            fullWidth
                            disabled={plan.name === "free"}
                          >
                            {plan.name === "free" ? "Free Plan" : `Get ${plan.displayName}`}
                          </Button>
                        </Form>
                      )}
                    </div>
                  </div>
                </Card>
              </Grid.Cell>
            ))}
          </Grid>
        </Layout.Section>
      </Layout>
    </Page>
  );
}