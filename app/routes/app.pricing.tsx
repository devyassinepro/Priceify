import { json, LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { useLoaderData, useActionData, Form, useNavigation , Link } from "@remix-run/react";
import { authenticate } from "../shopify.server";
import { useState, useEffect } from "react";
import { validatePricingData, validateProductData } from "../lib/validators";
import { logError, handleGraphQLErrors, createUserFriendlyError } from "../lib/error-handler";
import {
  Card,
  Layout,
  Page,
  DataTable,
  Button,
  TextField,
  Select,
  Banner,
  Checkbox,
  FormLayout,
  ButtonGroup,
  Text,
} from "@shopify/polaris";
import { GET_PRODUCTS } from "../graphql/queries/products";
import { UPDATE_PRODUCT_VARIANTS_BULK } from "../graphql/mutations/products";
import { db } from "../db.server";
// Ajoutez ces imports
import { getOrCreateSubscription, incrementUsage, checkUsageLimit } from "../models/subscription.server";
import { canUseFeature } from "../lib/plans";

// Types TypeScript
interface ActionResult {
  results: Array<{
    variantId: string;
    variantTitle: string;
    productTitle: string;
    oldPrice: number;
    newPrice: number;
    success: boolean;
    errors: Array<{ field?: string; message: string }>;
  }>;
  totalUpdated: number;
  totalAttempted: number;
  globalError?: string;
  redirectToUpgrade?: boolean; // ← Ajoutez cette ligne
}

interface LoaderData {
  products: {
    edges: any[];
  };
  subscription: {
    id: string;
    shop: string;
    planName: string;
    usageCount: number;
    usageLimit: number;
  };
  pagination: {
    hasNextPage: boolean;
    hasPreviousPage: boolean;
    startCursor: string;
    endCursor: string;
  };
  currentPage: {
    after: string | null;
    before: string | null;
    first: number;
  };
}

interface VariantUpdateInput {
  id: string;
  price: string;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  
  const url = new URL(request.url);
  const after = url.searchParams.get("after");
  const before = url.searchParams.get("before");
  const first = parseInt(url.searchParams.get("first") || "25");
  
  try {
    // Get subscription info avec gestion d'erreur
    const subscription = await getOrCreateSubscription(session.shop);
    
    // Construire les variables pour GraphQL
    const variables: any = {};
    
    if (after) {
      variables.first = first;
      variables.after = after;
    } else if (before) {
      variables.last = first;
      variables.before = before;
    } else {
      variables.first = first;
    }
    
    const response = await admin.graphql(GET_PRODUCTS, { variables });
    const data = await response.json();
    
    return json({
      products: data.data.products,
      subscription, // ← Assurer que c'est bien ici
      pagination: {
        hasNextPage: data.data.products.pageInfo.hasNextPage,
        hasPreviousPage: data.data.products.pageInfo.hasPreviousPage,
        startCursor: data.data.products.pageInfo.startCursor,
        endCursor: data.data.products.pageInfo.endCursor,
      },
      currentPage: {
        after,
        before,
        first,
      }
    });
  } catch (error) {
    console.error("Erreur dans le loader pricing:", error);
    
    // Retourner des données par défaut en cas d'erreur
    return json({
      products: { edges: [] },
      subscription: {
        usageCount: 0,
        usageLimit: 20,
        planName: 'free',
        shop: session.shop,
      },
      pagination: {
        hasNextPage: false,
        hasPreviousPage: false,
        startCursor: null,
        endCursor: null,
      },
      currentPage: { after, before, first }
    });
  }
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);

  try {
    const formData = await request.formData();
    const selectedProducts = JSON.parse(formData.get("selectedProducts") as string);
    const adjustmentType = formData.get("adjustmentType") as string;
    const adjustmentValue = parseFloat(formData.get("adjustmentValue") as string);

    // Check usage limits BEFORE processing
    const hasReachedLimit = await checkUsageLimit(session.shop);
    if (hasReachedLimit) {
      return json({
        globalError: "Monthly usage limit reached. Please upgrade your plan to continue.",
        redirectToUpgrade: true,
      });
    }

    // Validation des données
    const validation = validatePricingData(selectedProducts, adjustmentType, adjustmentValue);
    if (!validation.isValid) {
      return json({
        globalError: validation.errors.join(", "),
        validationErrors: validation.errors,
      });
    }

    // Validation des produits (avec type explicite)
    const invalidProducts = selectedProducts.filter((p: any) => !validateProductData(p));
    if (invalidProducts.length > 0) {
      return json({
        globalError: `${invalidProducts.length} produit(s) ont des données invalides`,
      });
    }
    
    const results: ActionResult['results'] = [];
    
    for (const productData of selectedProducts) {
      const variantsToUpdate: VariantUpdateInput[] = [];
      
      for (const variant of productData.variants) {
        let newPrice: number;
        
        switch (adjustmentType) {
          case "percentage":
            newPrice = variant.currentPrice * (1 + adjustmentValue / 100);
            break;
          case "fixed":
            newPrice = adjustmentValue;
            break;
          case "add":
            newPrice = variant.currentPrice + adjustmentValue;
            break;
          case "subtract":
            newPrice = variant.currentPrice - adjustmentValue;
            break;
          default:
            newPrice = variant.currentPrice;
        }
        
        newPrice = Math.max(0.01, Math.round(newPrice * 100) / 100);
        
        variantsToUpdate.push({
          id: variant.id,
          price: newPrice.toFixed(2),
        });
      }
      
      const response = await admin.graphql(UPDATE_PRODUCT_VARIANTS_BULK, {
        variables: {
          productId: productData.id,
          variants: variantsToUpdate,
        },
      });
      
      const result = await response.json();
      
      if (result.data?.productVariantsBulkUpdate) {
        const bulkResult = result.data.productVariantsBulkUpdate;
        
        productData.variants.forEach((variant: any, index: number) => {
          const hasErrors = bulkResult.userErrors.some((error: any) => 
            error.field && error.field.includes(`variants[${index}]`)
          );
          
          results.push({
            variantId: variant.id,
            variantTitle: variant.title,
            productTitle: productData.title,
            oldPrice: variant.currentPrice,
            newPrice: parseFloat(variantsToUpdate[index].price),
            success: !hasErrors,
            errors: hasErrors 
              ? bulkResult.userErrors.filter((error: any) => error.field && error.field.includes(`variants[${index}]`))
              : [],
          });
        });
      }
    }
    
    const successfulUpdates = results.filter(r => r.success);

        // If successful updates, increment usage
        if (successfulUpdates.length > 0) {
          const canIncrement = await incrementUsage(session.shop);
          if (!canIncrement) {
            return json({
              globalError: "Usage limit reached during processing.",
              redirectToUpgrade: true,
            });
          }
        }

    // Sauvegarder l'historique
    try {
      for (const result of successfulUpdates) {
        const productData = selectedProducts.find((p: any) => 
          p.variants.some((v: any) => v.id === result.variantId)
        );
        
        if (productData) {
          await db.pricingHistory.create({
            data: {
              shop: session.shop,
              productId: productData.id,
              variantId: result.variantId,
              productTitle: result.productTitle,
              variantTitle: result.variantTitle,
              actionType: adjustmentType,
              adjustmentValue: adjustmentValue,
              oldPrice: result.oldPrice,
              newPrice: result.newPrice,
              userEmail: session.shop,
            },
          });
        }
      }
      console.log(`✅ Sauvegardé ${successfulUpdates.length} entrées d'historique`);
    } catch (historyError) {
      console.error("❌ Erreur lors de la sauvegarde de l'historique:", historyError);
    }

    return json({ 
      results, 
      totalUpdated: successfulUpdates.length,
      totalAttempted: results.length,
    });
    
  } catch (error: any) {
    const userMessage = createUserFriendlyError(error, "la mise à jour des prix");
    
    await logError({
      shop: session.shop,
      errorType: "PRICING_ACTION_ERROR",
      message: error.message,
      context: { stack: error.stack },
      timestamp: new Date(),
    });
    
    return json({ 
      globalError: userMessage,
    });
  }
};

export default function Pricing() {
  const data = useLoaderData<LoaderData>(); // ← Type explicite
  const actionData = useActionData<ActionResult>();
  const navigation = useNavigation();
  
  const products = data.products.edges;
  const subscription = data.subscription || { usageCount: 0, usageLimit: 20, planName: 'free' }; // ← Valeur par défaut
  const pagination = data.pagination;
  const currentPage = data.currentPage;

  // Add usage warning banner
    // Calculer le pourcentage avec sécurité
    const usagePercentage = subscription.usageLimit > 0 
    ? (subscription.usageCount / subscription.usageLimit) * 100 
    : 0;
  
  const [selectedProducts, setSelectedProducts] = useState<Set<string>>(new Set());
  const [adjustmentType, setAdjustmentType] = useState("percentage");
  const [adjustmentValue, setAdjustmentValue] = useState("10");
  
  // Nouveaux états pour les filtres
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [filteredProducts, setFilteredProducts] = useState(products);
  
  const isLoading = navigation.state === "submitting";


  // Fonctions de pagination
const buildPaginationUrl = (direction: 'next' | 'prev' | 'first') => {
  const params = new URLSearchParams();
  params.set('first', currentPage.first.toString());
  
  switch (direction) {
    case 'next':
      if (pagination.endCursor) {
        params.set('after', pagination.endCursor);
      }
      break;
    case 'prev':
      if (pagination.startCursor) {
        params.set('before', pagination.startCursor);
      }
      break;
    case 'first':
      // Pas de paramètres supplémentaires pour la première page
      break;
  }
  
  return `/app/pricing?${params.toString()}`;
};


  // Fonction de filtrage
  useEffect(() => {
    let filtered = products;
    
    // Filtrer par recherche (nom de produit)
    if (searchQuery.trim()) {
      filtered = filtered.filter((edge: any) =>
        edge.node.title.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }
    
    // Filtrer par statut
    if (statusFilter !== "all") {
      filtered = filtered.filter((edge: any) => 
        edge.node.status === statusFilter
      );
    }
    
    setFilteredProducts(filtered);
    
    // Nettoyer les sélections qui ne sont plus visibles
    const visibleProductIds = new Set(filtered.map((edge: any) => edge.node.id));
    const newSelected = new Set([...selectedProducts].filter(id => visibleProductIds.has(id)));
    if (newSelected.size !== selectedProducts.size) {
      setSelectedProducts(newSelected);
    }
  }, [searchQuery, statusFilter, products, selectedProducts]);

  const handleSelectProduct = (productId: string, checked: boolean) => {
    const newSelected = new Set(selectedProducts);
    if (checked) {
      newSelected.add(productId);
    } else {
      newSelected.delete(productId);
    }
    setSelectedProducts(newSelected);
  };

  const handleSelectAll = () => {
    if (selectedProducts.size === filteredProducts.length && filteredProducts.length > 0) {
      setSelectedProducts(new Set());
    } else {
      const allVisibleProductIds = filteredProducts.map((edge: any) => edge.node.id);
      setSelectedProducts(new Set(allVisibleProductIds));
    }
  };

  const calculateNewPrice = (currentPrice: number) => {
    const value = parseFloat(adjustmentValue);
    switch (adjustmentType) {
      case "percentage":
        return currentPrice * (1 + value / 100);
      case "fixed":
        return value;
      case "add":
        return currentPrice + value;
      case "subtract":
        return currentPrice - value;
      default:
        return currentPrice;
    }
  };

  const getSelectedProductsData = () => {
    return products
      .filter((edge: any) => selectedProducts.has(edge.node.id))
      .map((edge: any) => {
        const product = edge.node;
        return {
          id: product.id,
          title: product.title,
          variants: product.variants.edges.map((vEdge: any) => ({
            id: vEdge.node.id,
            title: vEdge.node.title,
            currentPrice: parseFloat(vEdge.node.price),
          })),
        };
      });
  };

  const rows = filteredProducts.map((edge: any) => {
    const product = edge.node;
    const variants = product.variants.edges;
    const isSelected = selectedProducts.has(product.id);
    
    return [
      <Checkbox
        label=""
        checked={isSelected}
        onChange={(checked) => handleSelectProduct(product.id, checked)}
      />,
      product.title,
      `${variants.length} variante(s)`,
      variants.length > 0 ? `€${variants[0].node.price}` : "N/A",
      isSelected && variants.length > 0
        ? `€${calculateNewPrice(parseFloat(variants[0].node.price)).toFixed(2)}`
        : "-",
    ];
  });

  return (
    <Page title="💰 Dynamic Pricing" backAction={{ content: "← Back", url: "/app" }}>
      <Layout>
           {/* Usage warning banner */}
      {usagePercentage > 80 && (
        <Layout.Section>
          <Banner 
            tone={usagePercentage >= 100 ? "critical" : "warning"}
            title={usagePercentage >= 100 ? "Usage Limit Reached" : "Usage Limit Warning"}
            action={usagePercentage >= 100 ? {
              content: "Upgrade Now",
              url: "/app/billing"
            } : undefined}
          >
            <Text as="p">
              You've used {subscription.usageCount}/{subscription.usageLimit} modifications 
              ({usagePercentage.toFixed(1)}%) this month.
              {usagePercentage >= 100 && " Upgrade to continue making changes."}
            </Text>
          </Banner>
        </Layout.Section>
      )}

      {/* Redirect to upgrade if needed */}
      {actionData?.redirectToUpgrade && (
        <Layout.Section>
          <Banner tone="critical" title="Upgrade Required" 
            action={{ content: "Upgrade Now", url: "/app/billing" }}>
            <Text as="p">You've reached your usage limit. Upgrade to continue.</Text>
          </Banner>
        </Layout.Section>
      )}
        {actionData && (
          <Layout.Section>
            {actionData.globalError ? (
              <Banner tone="critical">
                <Text as="p">{actionData.globalError}</Text>
              </Banner>
            ) : (
              <Banner tone="success">
                <Text as="p">
                  ✅ {actionData.totalUpdated} prix mis à jour avec succès 
                  sur {actionData.totalAttempted} tentatives
                </Text>
              </Banner>
            )}
          </Layout.Section>
        )}

        {/* Section des filtres */}
        <Layout.Section>
          <Card>
            <div style={{ padding: "1rem" }}>
              <Text as="h2" variant="headingMd">🔍 Filtres</Text>
              
              <FormLayout>
                <TextField
                  label="Rechercher un produit"
                  value={searchQuery}
                  onChange={setSearchQuery}
                  placeholder="Nom du produit..."
                  autoComplete="off"
                  clearButton
                  onClearButtonClick={() => setSearchQuery("")}
                />
                
                <Select
                  label="Statut des produits"
                  value={statusFilter}
                  onChange={setStatusFilter}
                  options={[
                    { label: "Tous les produits", value: "all" },
                    { label: "Actifs seulement", value: "ACTIVE" },
                    { label: "Brouillons", value: "DRAFT" },
                    { label: "Archivés", value: "ARCHIVED" },
                  ]}
                />

                            {/* Ajoutez ici le sélecteur de taille de page */}
                  <Select
                    label="Produits par page"
                    value={currentPage.first.toString()}
                    onChange={(value) => {
                      const params = new URLSearchParams();
                      params.set('first', value);
                      window.location.href = `/app/pricing?${params.toString()}`;
                    }}
                    options={[
                      { label: "10 produits", value: "10" },
                      { label: "25 produits", value: "25" },
                      { label: "50 produits", value: "50" },
                      { label: "100 produits", value: "100" },
                    ]}
                  />
                
                <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                  <Text as="span">
                    {filteredProducts.length} produit(s) affiché(s) sur {products.length}
                  </Text>
                  
                  {(searchQuery || statusFilter !== "all") && (
                    <Button 
                      size="micro" 
                      onClick={() => {
                        setSearchQuery("");
                        setStatusFilter("all");
                      }}
                    >
                      Réinitialiser
                    </Button>
                  )}
                </div>
              </FormLayout>
            </div>
          </Card>
        </Layout.Section>

        {/* Formulaire de modification */}
        <Layout.Section>
          <Card>
            <div style={{ padding: "1rem" }}>
              <Text as="h2" variant="headingMd">
                ⚙️ Configuration des modifications
              </Text>
              
              <Form method="post">
                <FormLayout>
                  <Select
                    label="Type de modification"
                    value={adjustmentType}
                    onChange={setAdjustmentType}
                    options={[
                      { label: "Pourcentage (%)", value: "percentage" },
                      { label: "Prix fixe (€)", value: "fixed" },
                      { label: "Ajouter un montant (+€)", value: "add" },
                      { label: "Soustraire un montant (-€)", value: "subtract" },
                    ]}
                  />
                  
                  <TextField
                    label="Valeur"
                    value={adjustmentValue}
                    onChange={setAdjustmentValue}
                    type="number"
                    autoComplete="off"
                    helpText={
                      adjustmentType === "percentage" 
                        ? "Exemple: 10 pour +10%" 
                        : "Montant en euros"
                    }
                  />
                  
                  <input 
                    type="hidden" 
                    name="selectedProducts" 
                    value={JSON.stringify(getSelectedProductsData())} 
                  />
                  <input type="hidden" name="adjustmentType" value={adjustmentType} />
                  <input type="hidden" name="adjustmentValue" value={adjustmentValue} />
                  
                  <ButtonGroup>
                    <Button
                      submit
                      variant="primary"
                      loading={isLoading}
                      disabled={selectedProducts.size === 0}
                    >
                      {isLoading ? "Application..." : "🚀 Appliquer les modifications"}
                    </Button>
                  </ButtonGroup>
                </FormLayout>
              </Form>
            </div>
          </Card>
        </Layout.Section>

        {/* Tableau des produits */}
        <Layout.Section>
          <Card>
            <div style={{ padding: "1rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
                <Text as="h2" variant="headingMd">
                  📦 Produits ({selectedProducts.size} sélectionné{selectedProducts.size > 1 ? 's' : ''} sur {filteredProducts.length} affiché{filteredProducts.length > 1 ? 's' : ''})
                </Text>
                <Button onClick={handleSelectAll}>
                  {selectedProducts.size === filteredProducts.length && filteredProducts.length > 0 ? "Désélectionner tout" : "Sélectionner tout"}
                </Button>
              </div>
              
              <DataTable
                columnContentTypes={['text', 'text', 'text', 'text', 'text']}
                headings={['✓', 'Produit', 'Variantes', 'Prix actuel', 'Nouveau prix']}
                rows={rows}
              />
            </div>
          </Card>
        </Layout.Section>
        {/* Pagination */}
        {(pagination.hasNextPage || pagination.hasPreviousPage) && (
          <Layout.Section>
            <Card>
              <div style={{ 
                padding: "1rem", 
                display: "flex", 
                justifyContent: "space-between", 
                alignItems: "center" 
              }}>
                <div>
                  <Text as="p" tone="subdued">
                    Affichage de {products.length} produit(s) par page
                  </Text>
                </div>
                
                <ButtonGroup>
                  {pagination.hasPreviousPage && (
                    <Link to={buildPaginationUrl('first')}>
                      <Button>⏪ Premier</Button>
                    </Link>
                  )}
                  
                  {pagination.hasPreviousPage && (
                    <Link to={buildPaginationUrl('prev')}>
                      <Button>← Précédent</Button>
                    </Link>
                  )}
                  
                  {pagination.hasNextPage && (
                    <Link to={buildPaginationUrl('next')}>
                      <Button>Suivant →</Button>
                    </Link>
                  )}
                </ButtonGroup>
              </div>
            </Card>
          </Layout.Section>
          
        )}
      </Layout>
    </Page>
  );
}