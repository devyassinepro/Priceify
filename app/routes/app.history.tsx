import { json, LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useSearchParams } from "@remix-run/react";
import { authenticate } from "../shopify.server";
import { 
  Card, 
  Layout, 
  Page, 
  DataTable, 
  Text, 
  EmptyState,
  Filters,
  Badge,
  Button,
  ButtonGroup,
  Select,
  TextField,
  ChoiceList,
  DatePicker,
  Popover,
  Icon,
  InlineStack,
  BlockStack,
} from "@shopify/polaris";
import {
  FilterIcon,
} from "@shopify/polaris-icons";
import { db } from "../db.server";
import { useState, useCallback, useMemo } from "react";

interface HistoryEntry {
  id: string;
  createdAt: string;
  productTitle: string;
  variantTitle: string;
  actionType: string;
  adjustmentValue: number;
  oldPrice: number;
  newPrice: number;
  userEmail: string | null;
}

interface LoaderData {
  history: HistoryEntry[];
  totalCount: number;
  currentPage: number;
  totalPages: number;
  limit: number;
  stats: Array<{ actionType: string; _count: { actionType: number } }>;
  filters: {
    actionType?: string | null;
    search?: string | null;
    startDate?: string | null;
    endDate?: string | null;
  };
}

export const loader = async ({ request }: LoaderFunctionArgs): Promise<Response> => {
  const { session } = await authenticate.admin(request);
  
  const url = new URL(request.url);
  const page = parseInt(url.searchParams.get("page") || "1");
  const limit = parseInt(url.searchParams.get("limit") || "50");
  const actionType = url.searchParams.get("actionType");
  const search = url.searchParams.get("search");
  const startDate = url.searchParams.get("startDate");
  const endDate = url.searchParams.get("endDate");
  
  const offset = (page - 1) * limit;
  
  // Build where clause
  const where: any = { shop: session.shop };
  
  if (actionType && actionType !== "all") {
    where.actionType = actionType;
  }
  
  if (search) {
    where.OR = [
      { productTitle: { contains: search, mode: 'insensitive' } },
      { variantTitle: { contains: search, mode: 'insensitive' } },
    ];
  }
  
  if (startDate) {
    where.createdAt = { gte: new Date(startDate) };
  }
  
  if (endDate) {
    where.createdAt = {
      ...where.createdAt,
      lte: new Date(endDate)
    };
  }
  
  try {
    const [history, totalCount] = await Promise.all([
      db.pricingHistory.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
      }),
      db.pricingHistory.count({ where })
    ]);
    
    // Get summary statistics
    const stats = await db.pricingHistory.groupBy({
      by: ['actionType'],
      where: { shop: session.shop },
      _count: { actionType: true },
    });
    
    return json({ 
      history, 
      totalCount,
      currentPage: page,
      totalPages: Math.ceil(totalCount / limit),
      limit,
      stats,
      filters: {
        actionType,
        search,
        startDate,
        endDate
      }
    });
  } catch (error) {
    console.error("History loader error:", error);
    return json({ 
      history: [], 
      totalCount: 0,
      currentPage: 1,
      totalPages: 0,
      limit,
      stats: [],
      filters: {}
    });
  }
};

export default function History() {
  const { 
    history, 
    totalCount, 
    currentPage, 
    totalPages, 
    limit,
    stats,
    filters 
  } = useLoaderData<LoaderData>();
  
  const [searchParams, setSearchParams] = useSearchParams();
  
  // Filter states
  const safeFilters = filters || {};
  const [searchValue, setSearchValue] = useState(safeFilters.search || "");
  const [actionTypeFilter, setActionTypeFilter] = useState<string[]>(
    (safeFilters.actionType ? [safeFilters.actionType] : [])
  );
  const [dateRangePopoverActive, setDateRangePopoverActive] = useState(false);
  const [startDate, setStartDate] = useState<Date | undefined>(
    safeFilters.startDate ? new Date(safeFilters.startDate) : undefined
  );
  const [endDate, setEndDate] = useState<Date | undefined>(
    safeFilters.endDate ? new Date(safeFilters.endDate) : undefined
  );

  const handleFiltersQueryChange = useCallback((queryValue: string) => {
    setSearchValue(queryValue);
    updateUrlParams({ search: queryValue || undefined });
  }, []);

  const handleActionTypeChange = useCallback((value: string[]) => {
    setActionTypeFilter(value);
    updateUrlParams({ actionType: value[0] || undefined });
  }, []);

  const handleDateRangeChange = useCallback((start?: Date, end?: Date) => {
    setStartDate(start);
    setEndDate(end);
    updateUrlParams({ 
      startDate: start?.toISOString().split('T')[0],
      endDate: end?.toISOString().split('T')[0]
    });
  }, []);

  const updateUrlParams = (newParams: Record<string, string | undefined>) => {
    const params = new URLSearchParams(searchParams);
    
    Object.entries(newParams).forEach(([key, value]) => {
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
    });
    
    // Reset to page 1 when filters change
    params.set('page', '1');
    
    setSearchParams(params);
  };

  const clearAllFilters = useCallback(() => {
    setSearchValue("");
    setActionTypeFilter([]);
    setStartDate(undefined);
    setEndDate(undefined);
    setSearchParams(new URLSearchParams());
  }, [setSearchParams]);

  const getActionTypeBadge = (actionType: string) => {
    const badges = {
      percentage: <Badge tone="info">Percentage</Badge>,
      fixed: <Badge tone="success">Fixed Price</Badge>,
      add: <Badge tone="attention">Add Amount</Badge>,
      subtract: <Badge tone="critical">Subtract Amount</Badge>,
    };
    return badges[actionType as keyof typeof badges] || <Badge>{actionType}</Badge>;
  };

  const formatPriceChange = (oldPrice: number, newPrice: number) => {
    const difference = newPrice - oldPrice;
    const isIncrease = difference > 0;
    const percentageChange = oldPrice > 0 ? (difference / oldPrice) * 100 : 0;
    
    return (
      <div>
        <Text as="span" fontWeight="semibold" tone={isIncrease ? "success" : "critical"}>
          ${oldPrice.toFixed(2)} → ${newPrice.toFixed(2)}
        </Text>
        <br />
        <Text as="span" variant="bodySm" tone="subdued">
          {isIncrease ? "+" : ""}${difference.toFixed(2)} ({isIncrease ? "+" : ""}{percentageChange.toFixed(1)}%)
        </Text>
      </div>
    );
  };

  const appliedFilters = useMemo(() => {
    const filters = [];
    
    if (actionTypeFilter.length > 0) {
      filters.push({
        key: 'actionType',
        label: `Action: ${actionTypeFilter[0]}`,
        onRemove: () => handleActionTypeChange([]),
      });
    }
    
    if (startDate || endDate) {
      const dateRange = `${startDate?.toLocaleDateString() || '...'} - ${endDate?.toLocaleDateString() || '...'}`;
      filters.push({
        key: 'dateRange',
        label: `Date: ${dateRange}`,
        onRemove: () => handleDateRangeChange(undefined, undefined),
      });
    }
    
    return filters;
  }, [actionTypeFilter, startDate, endDate, handleActionTypeChange, handleDateRangeChange]);

  const buildPaginationUrl = (page: number) => {
    const params = new URLSearchParams(searchParams);
    params.set('page', page.toString());
    return `?${params.toString()}`;
  };

  if (history.length === 0 && !safeFilters.search && !safeFilters.actionType) {
    return (
      <Page title="Price Change History" backAction={{ content: "← Dashboard", url: "/app" }}>
        <Layout>
          <Layout.Section>
            <Card>
              <EmptyState
                heading="No price changes yet"
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                action={{
                  content: "Start Updating Prices",
                  url: "/app/pricing"
                }}
              >
                <p>Your price modifications will appear here once you start using the app.</p>
              </EmptyState>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  const rows = history.map((entry: HistoryEntry) => [
    new Date(entry.createdAt).toLocaleDateString(),
    new Date(entry.createdAt).toLocaleTimeString([], { 
      hour: '2-digit', 
      minute: '2-digit' 
    }),
    <div key={`product-${entry.id}`}>
      <Text as="span" fontWeight="semibold">{entry.productTitle}</Text>
      <br />
      <Text as="span" variant="bodySm" tone="subdued">{entry.variantTitle}</Text>
    </div>,
    getActionTypeBadge(entry.actionType),
    entry.actionType === 'percentage' 
      ? `${entry.adjustmentValue > 0 ? '+' : ''}${entry.adjustmentValue}%`
      : `${Math.abs(entry.adjustmentValue).toFixed(2)}`,
    formatPriceChange(entry.oldPrice, entry.newPrice),
    <Text key={`user-${entry.id}`} as="span" variant="bodySm" tone="subdued">
      {entry.userEmail || "System"}
    </Text>,
  ]);

  return (
    <Page 
      title="Price Change History"
      subtitle={`${totalCount} total modifications tracked`}
      backAction={{ content: "← Dashboard", url: "/app" }}
      primaryAction={
        <ButtonGroup>
          <Button disabled>
            Export CSV
          </Button>
          <Button url="/app/pricing">
            Update More Prices
          </Button>
        </ButtonGroup>
      }
    >
      <Layout>
        {/* Statistics Overview */}
        {stats.length > 0 && (
          <Layout.Section>
            <Card>
              <div style={{ padding: "1.5rem" }}>
                <BlockStack gap="300">
                  <Text as="h3" variant="headingMd">Modification Summary</Text>
                  <div style={{ 
                    display: "grid", 
                    gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", 
                    gap: "1rem" 
                  }}>
                    {stats.map((stat) => (
                      <div key={stat.actionType} style={{ textAlign: "center" }}>
                        <Text as="p" variant="headingMd">{stat._count.actionType}</Text>
                        <Text as="p" variant="bodySm" tone="subdued">
                          {stat.actionType} changes
                        </Text>
                      </div>
                    ))}
                    <div style={{ textAlign: "center" }}>
                      <Text as="p" variant="headingMd">{totalCount}</Text>
                      <Text as="p" variant="bodySm" tone="subdued">Total changes</Text>
                    </div>
                  </div>
                </BlockStack>
              </div>
            </Card>
          </Layout.Section>
        )}

        {/* Filters */}
        <Layout.Section>
          <Card>
            <div style={{ padding: "1rem" }}>
              <BlockStack gap="400">
                <InlineStack align="space-between">
                  <Text as="h3" variant="headingMd">
                    🔍 Filter History
                  </Text>
                  {appliedFilters.length > 0 && (
                    <Button size="micro" onClick={clearAllFilters}>
                      Clear All Filters
                    </Button>
                  )}
                </InlineStack>

                <Filters
                  queryValue={searchValue}
                  queryPlaceholder="Search products..."
                  onQueryChange={handleFiltersQueryChange}
                  onQueryClear={() => handleFiltersQueryChange("")}
                  onClearAll={clearAllFilters}
                  appliedFilters={appliedFilters}
                  filters={[
                    {
                      key: 'actionType',
                      label: 'Action Type',
                      filter: (
                        <ChoiceList
                          title="Action Type"
                          titleHidden
                          allowMultiple={false}
                          choices={[
                            { label: 'All Types', value: 'all' },
                            { label: 'Percentage Changes', value: 'percentage' },
                            { label: 'Fixed Price', value: 'fixed' },
                            { label: 'Add Amount', value: 'add' },
                            { label: 'Subtract Amount', value: 'subtract' },
                          ]}
                          selected={actionTypeFilter}
                          onChange={handleActionTypeChange}
                        />
                      ),
                    },
                    {
                      key: 'dateRange',
                      label: 'Date Range',
                      filter: (
                        <Popover
                          active={dateRangePopoverActive}
                          activator={
                            <Button
                              onClick={() => setDateRangePopoverActive(!dateRangePopoverActive)}
                            >
                              📅 {startDate || endDate 
                                ? `${startDate?.toLocaleDateString() || '...'} - ${endDate?.toLocaleDateString() || '...'}`
                                : 'Select date range'
                              }
                            </Button>
                          }
                          onClose={() => setDateRangePopoverActive(false)}
                        >
                          <div style={{ padding: "1rem", width: "300px" }}>
                            <BlockStack gap="300">
                              <Text as="h4" variant="headingMd">Date Range</Text>
                              <div>
                              <Text as="p" variant="bodySm">From:</Text>
                                <DatePicker
                                  month={startDate?.getMonth() || new Date().getMonth()}
                                  year={startDate?.getFullYear() || new Date().getFullYear()}
                                  selected={startDate}
                                  onMonthChange={(month, year) => {
                                    // Handle month change if needed
                                  }}
                                  onChange={(date) => {
                                    handleDateRangeChange(date.start, endDate);
                                    setDateRangePopoverActive(false);
                                  }}
                                />
                              </div>
                            </BlockStack>
                          </div>
                        </Popover>
                      ),
                    },
                  ]}
                />
              </BlockStack>
            </div>
          </Card>
        </Layout.Section>

        {/* History Table */}
        <Layout.Section>
          <Card>
            <div style={{ padding: "1rem" }}>
              <BlockStack gap="300">
                <InlineStack align="space-between">
                  <Text as="h3" variant="headingMd">
                    Recent Changes
                    {totalCount > 0 && (
                      <Text as="span" variant="bodySm" tone="subdued">
                        {" "}({totalCount} total)
                      </Text>
                    )}
                  </Text>
                  <Select
                    label=""
                    labelHidden
                    value={limit.toString()}
                    onChange={(value) => {
                      const params = new URLSearchParams(searchParams);
                      params.set('limit', value);
                      params.set('page', '1');
                      setSearchParams(params);
                    }}
                    options={[
                      { label: "Show 25", value: "25" },
                      { label: "Show 50", value: "50" },
                      { label: "Show 100", value: "100" },
                    ]}
                  />
                </InlineStack>
                
                {history.length === 0 ? (
                  <EmptyState
                    heading="No changes found"
                    image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                    action={{
                      content: "Clear Filters",
                      onAction: clearAllFilters
                    }}
                  >
                    <p>Try adjusting your search or filter criteria</p>
                  </EmptyState>
                ) : (
                  <>
                    <DataTable
                      columnContentTypes={['text', 'text', 'text', 'text', 'text', 'text', 'text']}
                      headings={[
                        'Date', 
                        'Time', 
                        'Product', 
                        'Action', 
                        'Value', 
                        'Price Change', 
                        'User'
                      ]}
                      rows={rows}
                      footerContent={
                        totalPages > 1 ? 
                          `Page ${currentPage} of ${totalPages} (${totalCount} total)` :
                          `Showing ${history.length} of ${totalCount} changes`
                      }
                    />

                    {/* Pagination */}
                    {totalPages > 1 && (
                      <div style={{ 
                        display: "flex", 
                        justifyContent: "center", 
                        alignItems: "center",
                        gap: "1rem",
                        marginTop: "1rem"
                      }}>
                        <ButtonGroup>
                          {currentPage > 1 && (
                            <>
                              <Button
                                url={buildPaginationUrl(1)}
                                disabled={currentPage === 1}
                              >
                                First
                              </Button>
                              <Button
                                url={buildPaginationUrl(currentPage - 1)}
                                disabled={currentPage === 1}
                              >
                                ← Previous
                              </Button>
                            </>
                          )}
                          
                          <Text as="p" variant="bodySm" tone="subdued">
                            Page {currentPage} of {totalPages}
                          </Text>
                          
                          {currentPage < totalPages && (
                            <>
                              <Button
                                url={buildPaginationUrl(currentPage + 1)}
                                disabled={currentPage === totalPages}
                              >
                                Next →
                              </Button>
                              <Button
                                url={buildPaginationUrl(totalPages)}
                                disabled={currentPage === totalPages}
                              >
                                Last
                              </Button>
                            </>
                          )}
                        </ButtonGroup>
                      </div>
                    )}
                  </>
                )}
              </BlockStack>
            </div>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}