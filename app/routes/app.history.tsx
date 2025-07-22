import { json, LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { authenticate } from "../shopify.server";
import { Card, Layout, Page, DataTable, Text, EmptyState } from "@shopify/polaris";
import { db } from "../db.server";



export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  
  // Récupérer l'historique des 50 dernières modifications
  const history = await db.pricingHistory.findMany({
    where: { shop: session.shop },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  
  return json({ history });
};

export default function History() {
  const { history } = useLoaderData<typeof loader>();
  
  if (history.length === 0) {
    return (
      <Page title="📋 Historique des modifications">
        <Layout>
          <Layout.Section>
            <Card>
              <EmptyState
                heading="Aucune modification pour le moment"
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              >
                <p>Vos modifications de prix apparaîtront ici.</p>
              </EmptyState>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }
  
  const rows = history.map((entry) => [
    new Date(entry.createdAt).toLocaleDateString("fr-FR"),
    new Date(entry.createdAt).toLocaleTimeString("fr-FR"),
    entry.productTitle,
    entry.variantTitle,
    entry.actionType,
    `€${entry.oldPrice.toFixed(2)}`,
    `€${entry.newPrice.toFixed(2)}`,
    entry.userEmail || "Système",
  ]);
  
  return (
    <Page 
      title="📋 Historique des modifications"
      backAction={{ content: "← Retour", url: "/app" }}
    >
      <Layout>
        <Layout.Section>
          <Card>
            <div style={{ padding: "1rem" }}>
              <Text as="h2" variant="headingMd">
                Dernières modifications ({history.length})
              </Text>
              
              <div style={{ marginTop: "1rem" }}>
                <DataTable
                  columnContentTypes={["text", "text", "text", "text", "text", "text", "text", "text"]}
                  headings={["Date", "Heure", "Produit", "Variante", "Type", "Ancien prix", "Nouveau prix", "Utilisateur"]}
                  rows={rows}
                />
              </div>
            </div>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}