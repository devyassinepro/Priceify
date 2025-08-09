import { json, LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, Link } from "@remix-run/react";
import { authenticate } from "../shopify.server";
import { getOrCreateSubscription } from "../models/subscription.server";
import { PLANS } from "../lib/plans";
import {
  Card,
  Layout,
  Page,
  Text,
  Button,
  ButtonGroup,
  Banner,
  DataTable,
  Badge,
  BlockStack,
  InlineStack,
} from "@shopify/polaris";

type CheckResult = {
  success: true;
  shop: string;
  localSubscription: any;
  shopifySubscriptions: any[];
  analysis: {
    hasActiveSubscription: boolean;
    priceMatch: boolean;
    statusMatch: boolean;
    recommendedAction: string;
    syncNeeded: boolean;
  };
} | {
  success: false;
  error: string;
  shop: string;
};

export const loader = async ({ request }: LoaderFunctionArgs): Promise<Response> => {
  const { admin, session } = await authenticate.admin(request);
  
  try {
    // Récupérer l'abonnement local
    const localSubscription = await getOrCreateSubscription(session.shop);
    
    // Récupérer les abonnements Shopify
    const response = await admin.graphql(`
      query GetAppSubscriptions {
        app {
          installation {
            activeSubscriptions {
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
      }
    `);
    
    const data = await response.json();
    const shopifySubscriptions = data.data?.app?.installation?.activeSubscriptions || [];
    
    // Analyser la synchronisation
    let analysis = {
      hasActiveSubscription: shopifySubscriptions.length > 0,
      priceMatch: false,
      statusMatch: false,
      recommendedAction: "",
      syncNeeded: false
    };
    
    if (shopifySubscriptions.length === 0) {
      analysis.recommendedAction = localSubscription.planName === "free" 
        ? "No action needed - correctly on free plan"
        : "Local plan should be reset to free";
      analysis.syncNeeded = localSubscription.planName !== "free";
    } else {
      const activeSubscription = shopifySubscriptions[0];
      const amount = parseFloat(activeSubscription.lineItems?.[0]?.plan?.pricingDetails?.price?.amount || "0");
      
      // Trouver le plan correspondant
      let expectedPlan = "free";
      for (const [key, plan] of Object.entries(PLANS)) {
        if (Math.abs(plan.price - amount) < 0.02) {
          expectedPlan = key;
          break;
        }
      }
      
      analysis.priceMatch = localSubscription.planName === expectedPlan;
      analysis.statusMatch = localSubscription.status === "active";
      analysis.syncNeeded = !analysis.priceMatch || !analysis.statusMatch;
      
      if (analysis.syncNeeded) {
        analysis.recommendedAction = `Update local plan from "${localSubscription.planName}" to "${expectedPlan}"`;
      } else {
        analysis.recommendedAction = "Subscription is correctly synchronized";
      }
    }
    
    return json<CheckResult>({
      success: true,
      shop: session.shop,
      localSubscription,
      shopifySubscriptions,
      analysis
    });
    
  } catch (error: any) {
    console.error("Check subscription error:", error);
    return json<CheckResult>({
      success: false,
      error: error.message,
      shop: session.shop
    });
  }
};

export default function CheckSubscription() {
  const data = useLoaderData<CheckResult>();
  
  if (!data.success) {
    return (
      <Page title="❌ Subscription Check Failed" backAction={{ content: "← Dashboard", url: "/app" }}>
        <Layout>
          <Layout.Section>
            <Banner title="Error Checking Subscription" tone="critical">
              <Text as="p">Failed to check subscription status: {data.error}</Text>
            </Banner>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }
  
  const { shop, localSubscription, shopifySubscriptions, analysis } = data;
  
  const shopName = shop.replace('.myshopify.com', '');
  const pricingPlansUrl = `https://admin.shopify.com/store/${shopName}/charges/priceboost/pricing_plans`;
  
  return (
    <Page 
      title="🔍 Subscription Status Check" 
      subtitle={`Verification for ${shop}`}
      backAction={{ content: "← Dashboard", url: "/app" }}
    >
      <Layout>
        {/* Status général */}
        <Layout.Section>
          <Banner 
            title={analysis.syncNeeded ? "⚠️ Synchronization Needed" : "✅ Subscription Synchronized"}
            tone={analysis.syncNeeded ? "warning" : "success"}
            action={analysis.syncNeeded ? {
              content: "Sync Now",
              url: "/app/sync-subscription"
            } : undefined}
          >
            <Text as="p">{analysis.recommendedAction}</Text>
          </Banner>
        </Layout.Section>

        {/* Détails de l'abonnement local */}
        <Layout.Section>
          <Card>
            <div style={{ padding: "1.5rem" }}>
              <BlockStack gap="400">
                <Text as="h2" variant="headingLg">💾 Local Database Subscription</Text>
                
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem" }}>
                  <div>
                    <Text as="p" variant="headingMd">{localSubscription.planName.toUpperCase()}</Text>
                    <Text as="p" variant="bodySm" tone="subdued">Plan Name</Text>
                  </div>
                  
                  <div>
                    <Badge tone={localSubscription.status === "active" ? "success" : "critical"}>
                      {localSubscription.status}
                    </Badge>
                    <Text as="p" variant="bodySm" tone="subdued">Status</Text>
                  </div>
                  
                  <div>
                    <Text as="p" variant="headingMd">{localSubscription.usageCount} / {localSubscription.usageLimit}</Text>
                    <Text as="p" variant="bodySm" tone="subdued">Usage</Text>
                  </div>
                  
                  <div>
                    <Text as="p" variant="headingMd">${PLANS[localSubscription.planName]?.price || 0}</Text>
                    <Text as="p" variant="bodySm" tone="subdued">Expected Price</Text>
                  </div>
                </div>
              </BlockStack>
            </div>
          </Card>
        </Layout.Section>

        {/* Abonnements Shopify */}
        <Layout.Section>
          <Card>
            <div style={{ padding: "1.5rem" }}>
              <BlockStack gap="400">
                <InlineStack align="space-between">
                  <Text as="h2" variant="headingLg">🏪 Shopify Active Subscriptions</Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Found: {shopifySubscriptions.length}
                  </Text>
                </InlineStack>
                
                {shopifySubscriptions.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "2rem" }}>
                    <Text as="p" tone="subdued">No active subscriptions found in Shopify</Text>
                    <div style={{ marginTop: "1rem" }}>
                      <Button url={pricingPlansUrl} external>
                        View Pricing Plans
                      </Button>
                    </div>
                  </div>
                ) : (
                  <DataTable
                    columnContentTypes={['text', 'text', 'text', 'text', 'text']}
                    headings={['ID', 'Status', 'Amount', 'Currency', 'Period End']}
                    rows={shopifySubscriptions.map((sub: any) => [
                      sub.id.split('/').pop(),
                      <Badge key={sub.id} tone={sub.status === "ACTIVE" ? "success" : "critical"}>
                        {sub.status}
                      </Badge>,
                      sub.lineItems?.[0]?.plan?.pricingDetails?.price?.amount || "0",
                      sub.lineItems?.[0]?.plan?.pricingDetails?.price?.currencyCode || "USD",
                      sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd).toLocaleDateString() : "N/A"
                    ])}
                  />
                )}
              </BlockStack>
            </div>
          </Card>
        </Layout.Section>

        {/* Actions disponibles */}
        <Layout.Section>
          <Card>
            <div style={{ padding: "1.5rem" }}>
              <BlockStack gap="400">
                <Text as="h2" variant="headingLg">🔧 Available Actions</Text>
                
                <ButtonGroup>
                  <Link to="/app/sync-subscription">
                    <Button variant="primary">
                      🔄 Sync Subscription
                    </Button>
                  </Link>
                  
                  <Button url={pricingPlansUrl} external>
                    🔗 Manage in Shopify
                  </Button>
                  
                  <Link to="/app">
                    <Button>
                      🏠 Back to Dashboard
                    </Button>
                  </Link>
                  
                  <Button onClick={() => window.location.reload()}>
                    ↻ Refresh Check
                  </Button>
                </ButtonGroup>
                
                {analysis.syncNeeded && (
                  <div style={{ marginTop: "1rem", padding: "1rem", backgroundColor: "#fff3cd", borderRadius: "4px" }}>
                    <Text as="p" variant="bodySm">
                      <strong>⚠️ Action Required:</strong> Your local subscription doesn't match Shopify's records. 
                      Click "Sync Subscription" to update your local database with the correct plan information.
                    </Text>
                  </div>
                )}
              </BlockStack>
            </div>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}