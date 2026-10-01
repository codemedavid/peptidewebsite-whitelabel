import { useState } from "react";
import { Pressable } from "react-native";
import { Stack } from "expo-router";
import { useCatalogProducts } from "@/features/admin/catalog/hooks";
import { removeRows, upsertRow, useCollection } from "@/features/admin/setup/data";
import { newId, str, type Row } from "@/features/admin/setup/rules";
import { ItemCard, ListPage, Loadable, confirmDelete } from "@/features/admin/setup/ui";
import { ReviewEditor, type ProductOption } from "@/features/admin/content/ReviewEditor";
import { ImageViewer, Thumb } from "@/features/admin/content/parts";
import { canOpenReviewViewer, reviewProductIds } from "@/features/admin/content/rules";
import { AppText, Pill } from "@/ui/primitives";

const NO_REVIEWS: Row[] = []; // the brand projection always lists reviews, so no starter set

/**
 * The website's Reviews (AdminReviewsManager → saveReviewsAction): customer
 * testimonials with an image, connected products and optional description
 * typography. Tap a thumbnail to proof it full size. Every change saves the
 * whole list, applied to the server's current copy.
 */
export default function ReviewsScreen() {
  const list = useCollection("reviews", "saveReviewsAction", NO_REVIEWS, "reviews");
  const products = useCatalogProducts(list.brand.data);
  const [editing, setEditing] = useState<{ row: Row; isNew: boolean } | null>(null);
  const [viewing, setViewing] = useState<Row | null>(null);

  const options: ProductOption[] = (products.data ?? []).map((p) => ({ id: p.id, name: p.name }));
  const productName = (id: string) => options.find((p) => p.id === id)?.name;

  const startAdd = () =>
    setEditing({
      row: { id: newId("rv"), headline: "", title: "", subtitle: "", badge: "Testimonial", image: "", productId: "", productIds: [] },
      isNew: true,
    });

  return (
    <>
      <Stack.Screen options={{ title: "Reviews" }} />
      <Loadable query={list.brand}>
        {() => (
          <>
            <ListPage
              intro="Customer testimonials for your Reviews page and the products they're connected to."
              addLabel="Add Review"
              onAdd={startAdd}
              isEmpty={list.items.length === 0}
              empty={{ icon: "star-outline", title: "No reviews yet.", action: "Add your first review" }}
              refreshing={list.brand.isRefetching}
              onRefresh={() => {
                void list.brand.refetch();
                void products.refetch();
              }}
            >
              {list.items.map((r, i) => {
                const title = str(r.title) || "Untitled";
                const image = str(r.image).trim();
                const canView = !!image && canOpenReviewViewer(r);
                const names = reviewProductIds(r)
                  .map(productName)
                  .filter((n): n is string => !!n);
                return (
                  <ItemCard
                    key={str(r.id) || String(i)}
                    title={title}
                    leading={
                      <Pressable
                        accessibilityRole="imagebutton"
                        accessibilityLabel={`View ${str(r.title) || "this review"} full size`}
                        disabled={!canView}
                        onPress={() => setViewing(r)}
                      >
                        <Thumb uri={image} icon="image-outline" label={title} />
                      </Pressable>
                    }
                    lines={[str(r.subtitle)]}
                    badges={
                      names.length > 0 || str(r.badge) ? (
                        <>
                          {str(r.badge) ? <Pill tone="info" size="sm" icon="star-outline" label={str(r.badge)} /> : null}
                          {names.map((n) => (
                            <Pill key={n} tone="neutral" size="sm" icon="cube-outline" label={n} />
                          ))}
                        </>
                      ) : undefined
                    }
                    disabled={list.saving}
                    onEdit={() => setEditing({ row: r, isNew: false })}
                    onDelete={() => confirmDelete("Delete this review?", () => void list.apply(removeRows(new Set([r.id]))))}
                  />
                );
              })}
            </ListPage>
            {editing ? (
              <ReviewEditor
                key={str(editing.row.id)}
                initial={editing.row}
                isNew={editing.isNew}
                products={options}
                productsError={products.isError ? (products.error?.message ?? "Please try again.") : null}
                saving={list.saving}
                onCancel={() => setEditing(null)}
                onSave={async (row) => {
                  if (await list.apply(upsertRow(row))) setEditing(null);
                }}
              />
            ) : null}
            {viewing ? (
              <ImageViewer
                uri={str(viewing.image)}
                title={str(viewing.headline) || str(viewing.title) || "Review"}
                onClose={() => setViewing(null)}
              >
                {str(viewing.title) ? (
                  <AppText variant="bodyStrong" color="#FFFFFF">
                    {str(viewing.title)}
                  </AppText>
                ) : null}
                {str(viewing.subtitle) ? (
                  <AppText variant="body" color="#FFFFFF">
                    {str(viewing.subtitle)}
                  </AppText>
                ) : null}
              </ImageViewer>
            ) : null}
          </>
        )}
      </Loadable>
    </>
  );
}
