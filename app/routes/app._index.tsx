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
  Banner
} from "@shopify/polaris";
import { getOrCreateSubscription } from "../models/subscription.server"; // ← Ajoutez cette ligne


export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const subscription = await getOrCreateSubscription(session.shop);

// Dans le JSX, ajoutez après les statistiques :
{subscription.planName === 'free' && (
  <Layout.Section>
    <Banner 
      title="🚀 Prêt pour plus ?"
      tone="info"
      action={{ content: "Voir les plans", url: "/app/billing" }}
    >
      <Text as="p">
        Vous utilisez le plan gratuit ({subscription.usageCount}/{subscription.usageLimit} modifications). 
        Découvrez nos plans payants pour plus de fonctionnalités !
      </Text>
    </Banner>
  </Layout.Section>
)}
  
  return json({
    shop: session.shop,
  });
};

export default function Index() {
  const { shop } = useLoaderData<typeof loader>();

  return (
    <Page title="Dynofy - Gestion des Prix">
      <Layout>
        <Layout.Section>
          <Banner title="Bienvenue !" tone="success">
            <Text as="p">
              Votre app est installée sur <strong>{shop}</strong> ! 
              Commencez par modifier les prix de vos produits.
            </Text>
          </Banner>
        </Layout.Section>
        
        <Layout.Section>
          <Card>
            <div style={{ padding: "2rem", textAlign: "center" }}>
              <Text as="h2" variant="headingMd">
                🚀 Que souhaitez-vous faire ?
              </Text>
              
              <div style={{ marginTop: "2rem" }}>
                <ButtonGroup>
                  <Link to="/app/pricing">
                    <Button 
                      variant="primary" 
                      size="large"
                    >
                      💰 Modifier les prix
                    </Button>
                  </Link>
                  
                  <Link to="/app/history">
                    <Button size="large">
                      📋 Voir l'historique
                    </Button>
                  </Link>
                </ButtonGroup>
              </div>
            </div>
          </Card>
        </Layout.Section>
        
        <Layout.Section>
          <Card>
            <div style={{ padding: "1rem" }}>
              <Text as="h3" variant="headingSm">ℹ️ Comment ça marche ?</Text>
              
              <div style={{ marginTop: "1rem" }}>
                <Text as="p">
                  1. <strong>Sélectionnez</strong> les produits à modifier
                </Text>
                <Text as="p">
                  2. <strong>Choisissez</strong> le type de modification (%, montant fixe, etc.)
                </Text>
                <Text as="p">
                  3. <strong>Prévisualisez</strong> les changements avant de les appliquer
                </Text>
                <Text as="p">
                  4. <strong>Confirmez</strong> pour mettre à jour vos prix
                </Text>
              </div>
            </div>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}