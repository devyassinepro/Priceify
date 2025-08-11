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
  Badge,
  DataTable,
  BlockStack,
} from "@shopify/polaris";

// ✅ Types explicites pour éviter les erreurs TypeScript
interface StatusSuccess {
  success: true;
  shop: string;
  localSubscription: any;
  shopifySubscriptions: any[];
  syncStatus: string;
  recommendations: string[];
  plans: typeof PLANS;
  timestamp: string;
}

interface StatusError {
  success: false;
  error: string;
  shop: string;
  timestamp: string;
}

type StatusData = StatusSuccess | StatusError;

export const loader = async ({ request }: LoaderFunctionArgs) => {
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
    const shopifySubscriptions = data.data?.app?.installation?.activeSubscriptions || [];
    
    // Analyser la synchronisation
    let syncStatus = "✅ Synchronized";
    let recommendations: string[] = [];
    
    if (shopifySubscriptions.length === 0) {
      if (localSubscription.planName !== "free") {
        syncStatus = "❌ Out of sync";
        recommendations.push("Local shows paid plan but no Shopify subscription found");
      }
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
      
      if (localSubscription.planName !== expectedPlan) {
        syncStatus = "❌ Out of sync";
        recommendations.push(`Local shows "${localSubscription.planName}" but Shopify shows "${expectedPlan}"`);
      }
    }
    
    return json<StatusSuccess>({
      success: true,
      shop: session.shop,
      localSubscription,
      shopifySubscriptions,
      syncStatus,
      recommendations,
      plans: PLANS,
      timestamp: new Date().toISOString()
    });
    
  } catch (error: any) {
    return json<StatusError>({
      success: false,
      error: error.message,
      shop: session.shop,
      timestamp: new Date().toISOString()
    });
  }
};

export default function Status() {
  const data = useLoaderData<StatusData>();
  
  if (!data.success) {
    return (
      <Page title="❌ Status Check Failed" backAction={{ content: "← Dashboard", url: "/app" }}>
        <Layout>
          <Layout.Section>
            <Card>
              <div style={{ padding: "1.5rem" }}>
                <Text as="h2" variant="headingLg">Error</Text>
                <Text as="p">Failed to check status: {data.error}</Text>
              </div>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }
  
  // ✅ TypeScript sait maintenant que c'est le type success
  const { 
    shop, 
    localSubscription, 
    shopifySubscriptions, 
    syncStatus, 
    recommendations, 
    plans, 
    timestamp 
  } = data;
  
  return (
    <Page 
      title="🔍 System Status" 
      subtitle={`Status check for ${shop}`}
      backAction={{ content: "← Dashboard", url: "/app" }}
    >
      <Layout>
        {/* Status général */}
        <Layout.Section>
          <Card>
            <div style={{ padding: "1.5rem" }}>
              <BlockStack gap="400">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <Text as="h2" variant="headingLg">System Status</Text>
                  <Badge tone={syncStatus.includes("✅") ? "success" : "critical"}>
                    {syncStatus}
                  </Badge>
                </div>
                
                <Text as="p" variant="bodySm" tone="subdued">
                  Last checked: {new Date(timestamp).toLocaleString()}
                </Text>
                
                {recommendations.length > 0 && (
                  <div>
                    <Text as="h3" variant="headingMd">Recommendations:</Text>
                    <ul>
                      {recommendations.map((rec: string, index: number) => (
                        <li key={index}><Text as="span" variant="bodySm">{rec}</Text></li>
                      ))}
                    </ul>
                  </div>
                )}
              </BlockStack>
            </div>
          </Card>
        </Layout.Section>

        {/* Local Subscription */}
        <Layout.Section>
          <Card>
            <div style={{ padding: "1.5rem" }}>
              <BlockStack gap="400">
                <Text as="h2" variant="headingLg">💾 Local Database</Text>
                
                <DataTable
                  columnContentTypes={['text', 'text']}
                  headings={['Property', 'Value']}
                  rows={[
                    ['Plan Name', localSubscription.planName.toUpperCase()],
                    ['Status', localSubscription.status],
                    ['Usage Count', `${localSubscription.usageCount} / ${localSubscription.usageLimit}`],
                    ['Subscription ID', localSubscription.subscriptionId || 'None'],
                    ['Expected Price', `${plans[localSubscription.planName as keyof typeof plans]?.price || 0}`],
                    ['Last Updated', new Date(localSubscription.updatedAt).toLocaleString()],
                  ]}
                />
              </BlockStack>
            </div>
          </Card>
        </Layout.Section>

        {/* Shopify Subscriptions */}
        <Layout.Section>
          <Card>
            <div style={{ padding: "1.5rem" }}>
              <BlockStack gap="400">
                <Text as="h2" variant="headingLg">🏪 Shopify Subscriptions</Text>
                
                {shopifySubscriptions.length === 0 ? (
                  <Text as="p" tone="subdued">No active subscriptions found in Shopify</Text>
                ) : (
                  <DataTable
                    columnContentTypes={['text', 'text', 'text', 'text']}
                    headings={['ID', 'Status', 'Amount', 'Period End']}
                    rows={shopifySubscriptions.map((sub: any) => [
                      sub.id.split('/').pop(),
                      sub.status,
                      `${sub.lineItems?.[0]?.plan?.pricingDetails?.price?.amount || '0'} ${sub.lineItems?.[0]?.plan?.pricingDetails?.price?.currencyCode || 'USD'}`,
                      sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd).toLocaleDateString() : 'N/A'
                    ])}
                  />
                )}
              </BlockStack>
            </div>
          </Card>
        </Layout.Section>

        {/* Actions */}
        <Layout.Section>
          <Card>
            <div style={{ padding: "1.5rem" }}>
              <BlockStack gap="400">
                <Text as="h2" variant="headingLg">🔧 Actions</Text>
                
                <ButtonGroup>
                  <Link to="/app/sync-subscription">
                    <Button variant="primary">
                      🔄 Sync Subscription
                    </Button>
                  </Link>
                  
                  <Link to="/app/plans">
                    <Button>
                      💳 Manage Plans
                    </Button>
                  </Link>
                  
                  <Button onClick={() => window.location.reload()}>
                    ↻ Refresh Status
                  </Button>
                  
                  <Link to="/app">
                    <Button>
                      🏠 Back to Dashboard
                    </Button>
                  </Link>
                </ButtonGroup>
              </BlockStack>
            </div>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}