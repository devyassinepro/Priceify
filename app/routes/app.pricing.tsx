import { json, LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { useLoaderData, useActionData, Form, useNavigation, Link } from "@remix-run/react";
import { authenticate } from "../shopify.server";
import { useState, useEffect } from "react";
import { validatePricingData, validateProductData } from "../lib/validators";
import { logError, handleGraphQLErrors, createUserFriendlyError } from "../lib/error-handler";
import { hasUnlimitedProducts, formatUsageDisplay, getPlanLimits } from "../lib/plans";

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
  Badge,
  Filters,
  ChoiceList,
  RangeSlider,
  EmptyState,
  Spinner,
  Toast,
  Frame,
  ProgressBar,
  BlockStack,
  InlineStack,
} from "@shopify/polaris";
import { GET_PRODUCTS } from "../graphql/queries/products";
import { UPDATE_PRODUCT_VARIANTS_BULK } from "../graphql/mutations/products";
import { db } from "../db.server";
import { 
  getOrCreateSubscription, 
  trackProductModifications, 
  wouldExceedProductLimit,
  getModifiedProductsThisPeriod
} from "../models/subscription.server";
import { canUseFeature } from "../lib/plans";

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
  uniqueProductsModified?: number;
  message?: string;
  globalError?: string;
  redirectToUpgrade?: boolean;
  quotaInfo?: {
    currentProducts: number;
    limit: number;
    wouldAdd: number;
    wouldTotal: number;
  };
}

interface LoaderData {
  products: { edges: any[]; };
  subscription: {
    id: string;
    shop: string;
    planName: string;
    usageCount: number;
    usageLimit: number;
    uniqueProductsModified?: string[];
    totalPriceChanges?: number;
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

export const loader = async ({ request }: LoaderFunctionArgs): Promise<Response> => {
  const { admin, session } = await authenticate.admin(request);
  
  const url = new URL(request.url);
  const after = url.searchParams.get("after");
  const before = url.searchParams.get("before");
  const first = parseInt(url.searchParams.get("first") || "25");
  
  try {
    const subscription = await getOrCreateSubscription(session.shop);
    
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
      subscription,
      pagination: {
        hasNextPage: data.data.products.pageInfo.hasNextPage,
        hasPreviousPage: data.data.products.pageInfo.hasPreviousPage,
        startCursor: data.data.products.pageInfo.startCursor,
        endCursor: data.data.products.pageInfo.endCursor,
      },
      currentPage: { after, before, first }
    });
  } catch (error) {
    console.error("Pricing loader error:", error);
    return json({
      products: { edges: [] },
      subscription: {
        id: "",
        usageCount: 0,
        usageLimit: 20,
        planName: 'free',
        shop: session.shop,
        uniqueProductsModified: [],
        totalPriceChanges: 0,
      },
      pagination: {
        hasNextPage: false,
        hasPreviousPage: false,
        startCursor: "",
        endCursor: "",
      },
      currentPage: { after, before, first }
    });
  }
};

export const action = async ({ request }: ActionFunctionArgs): Promise<Response> => {
  const { admin, session } = await authenticate.admin(request);

  try {
    const formData = await request.formData();
    const selectedProducts = JSON.parse(formData.get("selectedProducts") as string);
    const adjustmentType = formData.get("adjustmentType") as string;
    const adjustmentValue = parseFloat(formData.get("adjustmentValue") as string);

    // Extract unique product IDs from selection
    const productIds = selectedProducts.map((p: any) => p.id);
    
    // Check if this would exceed the PRODUCT limit (not price change limit)
    const wouldExceed = await wouldExceedProductLimit(session.shop, productIds);
    if (wouldExceed) {
      const subscription = await getOrCreateSubscription(session.shop);
      const currentProductsModified = (subscription.uniqueProductsModified as string[]) || [];
      const newProducts = productIds.filter((id: string) => !currentProductsModified.includes(id));
      
      return json({
        globalError: `This would modify ${newProducts.length} new product(s), exceeding your monthly limit of ${subscription.usageLimit} unique products. Please upgrade your plan or select fewer products.`,
        redirectToUpgrade: true,
        quotaInfo: {
          currentProducts: currentProductsModified.length,
          limit: subscription.usageLimit,
          wouldAdd: newProducts.length,
          wouldTotal: currentProductsModified.length + newProducts.length
        }
      });
    }

    const validation = validatePricingData(selectedProducts, adjustmentType, adjustmentValue);
    if (!validation.isValid) {
      return json({
        globalError: validation.errors.join(", "),
        validationErrors: validation.errors,
      });
    }

    const invalidProducts = selectedProducts.filter((p: any) => !validateProductData(p));
    if (invalidProducts.length > 0) {
      return json({
        globalError: `${invalidProducts.length} product(s) have invalid data`,
      });
    }
    
    const results: ActionResult['results'] = [];
    
    // Process the price updates
    for (const productData of selectedProducts) {
      const variantsToUpdate: any[] = [];
      
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
    
    const successfulUpdates = results.filter((r: any) => r.success);

    // NEW: Track product modifications instead of individual price changes
    if (successfulUpdates.length > 0) {
      const successfulProductIds = Array.from(new Set(
        successfulUpdates.map((result: any) => 
          selectedProducts.find((p: any) => 
            p.variants.some((v: any) => v.id === result.variantId)
          )?.id
        ).filter(Boolean)
      ));
      
      const trackingSuccess = await trackProductModifications(session.shop, successfulProductIds);
      if (!trackingSuccess) {
        return json({
          globalError: "Product limit reached during processing.",
          redirectToUpgrade: true,
        });
      }
    }

    // Save history
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
    } catch (historyError) {
      console.error("History save error:", historyError);
    }

    // Calculate unique products modified in this batch
    const uniqueProductsInBatch = Array.from(new Set(
      successfulUpdates.map((result: any) => 
        selectedProducts.find((p: any) => 
          p.variants.some((v: any) => v.id === result.variantId)
        )?.id
      ).filter(Boolean)
    )).length;

    return json({ 
      results, 
      totalUpdated: successfulUpdates.length,
      totalAttempted: results.length,
      uniqueProductsModified: uniqueProductsInBatch,
      message: `Successfully updated ${successfulUpdates.length} price(s) across ${uniqueProductsInBatch} unique product(s)`,
    });
    
  } catch (error: any) {
    const userMessage = createUserFriendlyError(error, "price updates");
    
    await logError({
      shop: session.shop,
      errorType: "PRICING_ACTION_ERROR",
      message: error.message,
      context: { stack: error.stack },
      timestamp: new Date(),
    });
    
    return json({ globalError: userMessage });
  }
};

export default function Pricing() {
    const data = useLoaderData<LoaderData>();
    const actionData = useActionData<ActionResult>();
    const navigation = useNavigation();
    
    const products = data.products.edges;
    const subscription = data.subscription || { 
      id: "",
      usageCount: 0, 
      usageLimit: 20, 
      planName: 'free', 
      shop: "",
      uniqueProductsModified: [],
      totalPriceChanges: 0,
    };
    const pagination = data.pagination;
    const currentPage = data.currentPage;
  
    // ✅ FIX: Better unlimited handling
    const planLimits = getPlanLimits(subscription.planName);
    const isUnlimited = planLimits.isUnlimited;
    const usagePercentage = isUnlimited ? 0 : (subscription.usageCount / subscription.usageLimit) * 100;
    
  const [selectedProducts, setSelectedProducts] = useState<Set<string>>(new Set());
  const [adjustmentType, setAdjustmentType] = useState("percentage");
  const [adjustmentValue, setAdjustmentValue] = useState("10");
  
  // Enhanced filter states
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [priceRange, setPriceRange] = useState<[number, number]>([0, 1000]);
  const [vendorFilter, setVendorFilter] = useState<string[]>([]);
  const [filteredProducts, setFilteredProducts] = useState(products);
  const [showToast, setShowToast] = useState(false);
  
  const isLoading = navigation.state === "submitting";

  // NEW: Calculate how many NEW products would be modified
  const getNewProductsCount = () => {
    const currentModified = (subscription.uniqueProductsModified as string[]) || [];
    const selectedArray = Array.from(selectedProducts);
    const newProducts = selectedArray.filter(id => !currentModified.includes(id));
    return newProducts.length;
  };

  const newProductsCount = getNewProductsCount();
  const wouldExceedAfterSelection = !isUnlimited && (subscription.usageCount + newProductsCount) > subscription.usageLimit;

  // Advanced filtering logic
  useEffect(() => {
    let filtered = products;
    
    if (searchQuery.trim()) {
      filtered = filtered.filter((edge: any) =>
        edge.node.title.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }
    
    if (statusFilter.length > 0) {
      filtered = filtered.filter((edge: any) => 
        statusFilter.includes(edge.node.status)
      );
    }

    if (vendorFilter.length > 0) {
      filtered = filtered.filter((edge: any) => 
        vendorFilter.includes(edge.node.vendor || "Unknown")
      );
    }
    
    // Price range filter
    filtered = filtered.filter((edge: any) => {
      const variants = edge.node.variants.edges;
      if (variants.length === 0) return true;
      const price = parseFloat(variants[0].node.price);
      return price >= priceRange[0] && price <= priceRange[1];
    });
    
    setFilteredProducts(filtered);
    
    const visibleProductIds = new Set(filtered.map((edge: any) => edge.node.id));
    const newSelected = new Set([...selectedProducts].filter(id => visibleProductIds.has(id)));
    if (newSelected.size !== selectedProducts.size) {
      setSelectedProducts(newSelected);
    }
  }, [searchQuery, statusFilter, vendorFilter, priceRange, products, selectedProducts]);

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

  // Get unique vendors for filter
  const uniqueVendors = Array.from(new Set(
    products.map((edge: any) => edge.node.vendor || "Unknown")
  )).sort();

  const clearFilters = () => {
    setSearchQuery("");
    setStatusFilter([]);
    setVendorFilter([]);
    setPriceRange([0, 1000]);
  };

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
    }
    
    return `/app/pricing?${params.toString()}`;
  };

  const rows = filteredProducts.map((edge: any) => {
    const product = edge.node;
    const variants = product.variants.edges;
    const isSelected = selectedProducts.has(product.id);
    
    return [
      <Checkbox
        key={`checkbox-${product.id}`}
        label=""
        checked={isSelected}
        onChange={(checked) => handleSelectProduct(product.id, checked)}
      />,
      <div key={`product-${product.id}`}>
        <Text as="span" fontWeight="semibold">{product.title}</Text>
        <br />
        <Text as="span" variant="bodySm" tone="subdued">{product.vendor}</Text>
      </div>,
      <Badge key={`status-${product.id}`} tone={product.status === "ACTIVE" ? "success" : "info"}>
        {product.status}
      </Badge>,
      `${variants.length} variant${variants.length !== 1 ? 's' : ''}`,
      variants.length > 0 ? `$${variants[0].node.price}` : "N/A",
      isSelected && variants.length > 0
        ? <Text key={`new-price-${product.id}`} as="span" fontWeight="semibold" tone="success">
            ${calculateNewPrice(parseFloat(variants[0].node.price)).toFixed(2)}
          </Text>
        : <Text key={`no-price-${product.id}`} as="span" tone="subdued">-</Text>,
    ];
  });

  const hasReachedLimit = !isUnlimited && usagePercentage >= 100;

  const toastMarkup = showToast ? (
    <Toast content="Prices updated successfully!" onDismiss={() => setShowToast(false)} />
  ) : null;

  // Show success toast
  useEffect(() => {
    if (actionData?.totalUpdated && actionData.totalUpdated > 0) {
      setShowToast(true);
    }
  }, [actionData]);

  return (
    <Frame>
      {toastMarkup}
      <Page 
        title="Dynamic Pricing" 
        subtitle="Bulk update product prices - quota based on unique products modified"
        backAction={{ content: "← Dashboard", url: "/app" }}
        primaryAction={
          <ButtonGroup>
            <Button disabled>
              📤 Export Changes
            </Button>
          </ButtonGroup>
        }
      >
        <Layout>
        <Layout.Section>
            <Card>
              <div style={{ padding: "1rem" }}>
                <InlineStack align="space-between">
                  <div>
                    <Text as="h3" variant="headingMd">
                      Monthly Usage: {formatUsageDisplay(subscription.usageCount, subscription.usageLimit)} unique products
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      Plan: {subscription.planName.charAt(0).toUpperCase() + subscription.planName.slice(1)}
                      {isUnlimited && " (Unlimited)"}
                    </Text>
                    {newProductsCount > 0 && !isUnlimited && (
                      <Text as="p" variant="bodySm" tone={wouldExceedAfterSelection ? "critical" : "success"}>
                        Selected: {newProductsCount} new product(s) • Would total: {subscription.usageCount + newProductsCount}
                      </Text>
                    )}
                    {newProductsCount > 0 && isUnlimited && (
                      <Text as="p" variant="bodySm" tone="success">
                        Selected: {newProductsCount} new product(s) • Unlimited plan - no limits!
                      </Text>
                    )}
                  </div>
                  <div style={{ width: "200px" }}>
                    {!isUnlimited && (
                      <ProgressBar 
                        progress={usagePercentage} 
                        size="small"
                        tone={usagePercentage >= 100 ? "critical" : "primary"}
                      />
                    )}
                    {isUnlimited && (
                      <Text as="p" variant="bodySm" tone="success">
                        ∞ Unlimited
                      </Text>
                    )}
                  </div>
                </InlineStack>
              </div>
            </Card>
          </Layout.Section>

          {/* Usage warning banner */}
        {/* ✅ UPDATED: Usage warning banner - only show for non-unlimited plans */}
        {!isUnlimited && usagePercentage > 80 && subscription.planName === 'free' && (
              <Layout.Section>
              <Banner 
                tone={hasReachedLimit ? "critical" : "warning"}
                title={hasReachedLimit ? "Usage Limit Reached" : "Approaching Usage Limit"}
                action={hasReachedLimit ? {
                  content: "Upgrade Now",
                  url: "/app/billing"
                } : {
                  content: "View Plans", 
                  url: "/app/billing"
                }}
              >
                <Text as="p">
                  You've used {usagePercentage.toFixed(1)}% of your monthly quota.
                  {hasReachedLimit && " Upgrade to continue making changes."}
                </Text>
              </Banner>
            </Layout.Section>
          )}

          {/* Updated warning banners */}
          {!isUnlimited && wouldExceedAfterSelection && (
            <Layout.Section>
              <Banner tone="critical" title="Product Limit Would Be Exceeded">
                <Text as="p">
                  You've selected {newProductsCount} new product(s) which would exceed your monthly limit of {subscription.usageLimit} unique products.
                  Please select fewer products or upgrade your plan.
                </Text>
              </Banner>
            </Layout.Section>
          )}


          {/* Action Results */}
          {actionData && (
            <Layout.Section>
              {actionData.globalError ? (
                <Banner tone="critical" title="Update Failed">
                  <Text as="p">{actionData.globalError}</Text>
                  {actionData.quotaInfo && (
                    <div style={{ marginTop: "0.5rem" }}>
                      <Text as="p" variant="bodySm">
                        Current: {actionData.quotaInfo.currentProducts} products • 
                        Limit: {actionData.quotaInfo.limit} • 
                        Would add: {actionData.quotaInfo.wouldAdd}
                      </Text>
                    </div>
                  )}
                  {actionData.redirectToUpgrade && (
                    <div style={{ marginTop: "1rem" }}>
                      <Link to="/app/billing">
                        <Button variant="primary">Upgrade Plan</Button>
                      </Link>
                    </div>
                  )}
                </Banner>
              ) : (
                <Banner tone="success" title="Prices Updated Successfully">
                  <Text as="p">
                    {actionData.message || `✅ ${actionData.totalUpdated} price(s) updated successfully`}
                  </Text>
                </Banner>
              )}
            </Layout.Section>
          )}
        
          {/* Advanced Filters */}
          <Layout.Section>
            <Card>
              <div style={{ padding: "1rem" }}>
                <BlockStack gap="400">
                  <InlineStack align="space-between">
                    <Text as="h2" variant="headingMd">
                      🔍 Advanced Filters
                    </Text>
                    <Button size="micro" onClick={clearFilters}>
                      Clear All
                    </Button>
                  </InlineStack>
                  
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: "1rem" }}>
                    <TextField
                      label="Search Products"
                      value={searchQuery}
                      onChange={setSearchQuery}
                      placeholder="🔍 Product name..."
                      clearButton
                      onClearButtonClick={() => setSearchQuery("")}
                      autoComplete="off"
                    />
                    
                    <div>
                      <Text as="p" variant="bodyMd">Product Status</Text>
                      <ChoiceList
                        title="Product Status" 
                        titleHidden
                        allowMultiple
                        choices={[
                          { label: "Active", value: "ACTIVE" },
                          { label: "Draft", value: "DRAFT" },
                          { label: "Archived", value: "ARCHIVED" },
                        ]}
                        selected={statusFilter}
                        onChange={setStatusFilter}
                      />
                    </div>

                    <div>
                      <Text as="p" variant="bodyMd">Vendor</Text>
                      <ChoiceList
                        title="Vendor" 
                        titleHidden
                        allowMultiple
                        choices={uniqueVendors.map(vendor => ({
                          label: vendor,
                          value: vendor
                        }))}
                        selected={vendorFilter}
                        onChange={setVendorFilter}
                      />
                    </div>

                    <div>
                      <Text as="p" variant="bodyMd">
                        Price Range: ${priceRange[0]} - ${priceRange[1]}
                      </Text>
                      <RangeSlider
                        label=""
                        value={priceRange}
                        onChange={(value) => setPriceRange(value as [number, number])}
                        output
                        min={0}
                        max={1000}
                        step={10}
                      />
                    </div>
                  </div>
                  
                  <InlineStack gap="200">
                    <Text as="p" variant="bodySm" tone="subdued">
                      Showing {filteredProducts.length} of {products.length} products
                    </Text>
                    {(searchQuery || statusFilter.length > 0 || vendorFilter.length > 0) && (
                      <Badge tone="info">Filters Applied</Badge>
                    )}
                  </InlineStack>
                </BlockStack>
              </div>
            </Card>
          </Layout.Section>

          {/* Pricing Configuration */}
          <Layout.Section>
            <Card>
              <div style={{ padding: "1rem" }}>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">
                    Pricing Configuration
                  </Text>
                  
                  <Form method="post">
                    {/* ... existing form fields ... */}
                    
                    <div style={{ marginTop: "1rem" }}>
                      <Button
                        submit
                        variant="primary"
                        loading={isLoading}
                        disabled={selectedProducts.size === 0 || (!isUnlimited && wouldExceedAfterSelection)}
                        size="large"
                      >
                        {isLoading ? "Processing..." : 
                         (!isUnlimited && wouldExceedAfterSelection) ? "Would Exceed Product Limit" :
                         `Update ${selectedProducts.size} Product(s) ${!isUnlimited && newProductsCount > 0 ? `(${newProductsCount} new)` : ''}`
                        }
                      </Button>
                      
                      {selectedProducts.size > 0 && (
                        <div style={{ marginTop: "0.5rem" }}>
                          <Text as="p" variant="bodySm" tone="subdued">
                            {isUnlimited 
                              ? "Unlimited plan - modify as many products as you want!"
                              : `This will count ${newProductsCount} new product(s) toward your monthly quota`
                            }
                          </Text>
                        </div>
                      )}
                    </div>
                  </Form>
                </BlockStack>
              </div>
            </Card>
          </Layout.Section>


          {/* Products Table */}
          <Layout.Section>
            <Card>
              <div style={{ padding: "1rem" }}>
                <BlockStack gap="300">
                  <InlineStack align="space-between">
                    <Text as="h2" variant="headingMd">
                      Products ({selectedProducts.size} selected)
                    </Text>
                    <ButtonGroup>
                      <Button 
                        onClick={handleSelectAll}
                        disabled={filteredProducts.length === 0}
                      >
                        {selectedProducts.size === filteredProducts.length && filteredProducts.length > 0 
                          ? "Deselect All" 
                          : "Select All Visible"
                        }
                      </Button>
                      <Select
                        label=""
                        labelHidden
                        value={currentPage.first.toString()}
                        onChange={(value) => {
                          const params = new URLSearchParams();
                          params.set('first', value);
                          window.location.href = `/app/pricing?${params.toString()}`;
                        }}
                        options={[
                          { label: "10 per page", value: "10" },
                          { label: "25 per page", value: "25" },
                          { label: "50 per page", value: "50" },
                          { label: "100 per page", value: "100" },
                        ]}
                      />
                    </ButtonGroup>
                  </InlineStack>
                  
                  {filteredProducts.length === 0 ? (
                    <EmptyState
                      heading="No products found"
                      image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                      action={{
                        content: "Clear Filters",
                        onAction: clearFilters
                      }}
                    >
                      <p>Try adjusting your search or filter criteria</p>
                    </EmptyState>
                  ) : (
                    <DataTable
                      columnContentTypes={['text', 'text', 'text', 'text', 'text', 'text']}
                      headings={['Select', 'Product', 'Status', 'Variants', 'Current Price', 'New Price']}
                      rows={rows}
                      footerContent={`Showing ${filteredProducts.length} of ${products.length} products`}
                    />
                  )}
                </BlockStack>
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
                  <Text as="p" variant="bodySm" tone="subdued">
                    Showing {products.length} products per page
                  </Text>
                  
                  <ButtonGroup>
                    {pagination.hasPreviousPage && (
                      <>
                        <Link to={buildPaginationUrl('first')}>
                          <Button>First</Button>
                        </Link>
                        <Link to={buildPaginationUrl('prev')}>
                          <Button>← Previous</Button>
                        </Link>
                      </>
                    )}
                    
                    {pagination.hasNextPage && (
                      <Link to={buildPaginationUrl('next')}>
                        <Button>Next →</Button>
                      </Link>
                    )}
                  </ButtonGroup>
                </div>
              </Card>
            </Layout.Section>
          )}

          {/* Help Section */}
          <Layout.Section>
            <Card>
              <div style={{ padding: "1.5rem", backgroundColor: "#f8f9fa" }}>
                <BlockStack gap="300">
                  <Text as="h3" variant="headingMd">💡 Pro Tips</Text>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: "1rem" }}>
                    <div>
                      <Text as="p" variant="bodySm">
                        <Text as="span" fontWeight="semibold">Product-Based Quota:</Text> Each unique product counts as 1 toward your monthly limit{isUnlimited ? " (unlimited on your plan!)" : ""}, regardless of how many variants you modify.
                      </Text>
                    </div>
                    <div>
                      <Text as="p" variant="bodySm">
                        <Text as="span" fontWeight="semibold">Preview Changes:</Text> Always check the "New Price" column before applying updates.
                      </Text>
                    </div>
                    <div>
                      <Text as="p" variant="bodySm">
                        <Text as="span" fontWeight="semibold">Multiple Updates:</Text> You can modify the same product multiple times within the month without using additional quota.
                      </Text>
                    </div>
                    {isUnlimited && (
                      <div>
                        <Text as="p" variant="bodySm">
                          <Text as="span" fontWeight="semibold">Unlimited Power:</Text> Your plan has no product limits - modify as many as you want!
                        </Text>
                      </div>
                    )}
                  </div>
                </BlockStack>
              </div>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    </Frame>
  );
}