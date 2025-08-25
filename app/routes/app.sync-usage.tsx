// app/routes/app.sync-usage.tsx - Emergency sync route
import { json, LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { useLoaderData, useActionData, Form } from "@remix-run/react";
import { authenticate } from "../shopify.server";
import { syncUsageCount, getOrCreateSubscription } from "../models/subscription.server";
import {
  Card,
  Layout,
  Page,
  Text,
  Button,
  Banner,
  BlockStack,
  DataTable,
} from "@shopify/polaris";

interface SyncResult {
  success: boolean;
  synced: boolean;
  oldCount?: number;
  newCount?: number;
  error?: string;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const subscription = await getOrCreateSubscription(session.shop);
  
  const currentProducts = (subscription.uniqueProductsModified as string[]) || [];
  const usageCountSynced = subscription.usageCount === currentProducts.length;
  
  return json({
    shop: session.shop,
    subscription,
    usageCountSynced,
    currentProductsCount: currentProducts.length,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  
  try {
    console.log(`🔄 Manual sync usage count for ${session.shop}`);
    
    const syncResult = await syncUsageCount(session.shop);
    
    return json<SyncResult>({
      success: true,
      synced: syncResult.synced,
      oldCount: syncResult.synced ? syncResult.oldCount : syncResult.count,
      newCount: syncResult.synced ? syncResult.newCount : syncResult.count,
    });
    
  } catch (error: any) {
    console.error("Sync usage count error:", error);
    return json<SyncResult>({
      success: false,
      synced: false,
      error: error.message
    });
  }
};

export default function SyncUsage() {
  const { shop, subscription, usageCountSynced, currentProductsCount } = useLoaderData<typeof loader>();
  const actionData = useActionData<SyncResult>();
  
  return (
    <Page 
      title="🔧 Sync Usage Count" 
      subtitle="Fix Products Modified counter"
      backAction={{ content: "← Dashboard", url: "/app" }}
    >
      <Layout>
        {/* Results */}
        {actionData && (
          <Layout.Section>
            {actionData.success ? (
              <Banner title="✅ Sync Successful" tone="success">
                <Text as="p">
                  {actionData.synced 
                    ? `Usage count updated from ${actionData.oldCount} to ${actionData.newCount}`
                    : `Usage count already correct: ${actionData.newCount}`
                  }
                </Text>
                <div style={{ marginTop: "1rem" }}>
                  <Button url="/app" variant="primary">
                    🏠 Back to Dashboard
                  </Button>
                </div>
              </Banner>
            ) : (
              <Banner title="❌ Sync Failed" tone="critical">
                <Text as="p">{actionData.error}</Text>
              </Banner>
            )}
          </Layout.Section>
        )}

        {/* Current Status */}
        <Layout.Section>
          <Card>
            <div style={{ padding: "1.5rem" }}>
              <BlockStack gap="300">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <Text as="h2" variant="headingLg">Current Status</Text>
                  {usageCountSynced ? (
                    <Banner tone="success" title="✅ Synced">
                      <Text as="p" variant="bodySm">Usage count matches product list</Text>
                    </Banner>
                  ) : (
                    <Banner tone="critical" title="❌ Out of Sync">
                      <Text as="p" variant="bodySm">Usage count needs correction</Text>
                    </Banner>
                  )}
                </div>
                
                <DataTable
                  columnContentTypes={['text', 'text']}
                  headings={['Property', 'Value']}
                  rows={[
                    ['Shop', shop],
                    ['Plan', subscription.planName.toUpperCase()],
                    ['Usage Count (Database)', subscription.usageCount.toString()],
                    ['Unique Products Modified (Array Length)', currentProductsCount.toString()],
                    ['Usage Limit', subscription.usageLimit.toString()],
                    ['Status', usageCountSynced ? '✅ Synced' : '❌ Out of Sync'],
                    ['Last Updated', new Date(subscription.updatedAt).toLocaleString()],
                  ]}
                />
              </BlockStack>
            </div>
          </Card>
        </Layout.Section>

        {/* Sync Action */}
        <Layout.Section>
          <Card>
            <div style={{ padding: "1.5rem" }}>
              <BlockStack gap="400">
                <Text as="h2" variant="headingLg">🔄 Sync Usage Count</Text>
                <Text as="p">
                  {usageCountSynced 
                    ? "Your usage count is already synchronized."
                    : `This will update the usage count from ${subscription.usageCount} to ${currentProductsCount} to match your unique products modified.`
                  }
                </Text>
                
                <Form method="post">
                  <Button
                    submit
                    variant={usageCountSynced ? "secondary" : "primary"}
                    size="large"
                  >
                    {usageCountSynced ? "🔄 Re-sync" : "🔧 Fix Usage Count"}
                  </Button>
                </Form>
              </BlockStack>
            </div>
          </Card>
        </Layout.Section>

        {/* Instructions */}
        <Layout.Section>
          <Card>
            <div style={{ padding: "1.5rem" }}>
              <BlockStack gap="300">
                <Text as="h3" variant="headingMd">📋 What This Does</Text>
                <div style={{ display: "grid", gap: "0.5rem" }}>
                  <Text as="p" variant="bodySm">
                    • Synchronizes the usage count with the actual number of unique products modified
                  </Text>
                  <Text as="p" variant="bodySm">
                    • Fixes any discrepancies between the counter and the data
                  </Text>
                  <Text as="p" variant="bodySm">
                    • Ensures the dashboard shows the correct "Products Modified" count
                  </Text>
                  <Text as="p" variant="bodySm">
                    • Safe operation - only updates the counter, doesn't affect your product modifications
                  </Text>
                </div>
              </BlockStack>
            </div>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}