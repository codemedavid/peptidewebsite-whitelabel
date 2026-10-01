import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ProductListResponse, ProductRow } from "@contract";
import { ApiError } from "@/api/client";
import { productsApi, qk } from "@/api/endpoints";
import { useSignedIn } from "@/auth/SessionProvider";

export function useProducts({ enabled = true }: { enabled?: boolean } = {}) {
  const { scope } = useSignedIn();
  return useQuery({ queryKey: qk.products(scope), queryFn: productsApi.list, enabled });
}

type Patch = { available?: boolean; stock?: number };

const LOW_STOCK_AT = 5; // same threshold the server uses (admin-dashboard LOW_STOCK_AT)

function replaceRow(list: ProductListResponse | undefined, row: ProductRow): ProductListResponse | undefined {
  return list ? { products: list.products.map((p) => (p.id === row.id ? row : p)) } : list;
}

function toneFor(stock: number | null): ProductRow["stockTone"] {
  if (stock === null) return "untracked";
  return stock === 0 ? "out" : stock <= LOW_STOCK_AT ? "low" : "ok";
}

/**
 * Availability / stock quick edits. Optimistic (a catalog toggle moves no money
 * and no stock), with a snapshot rollback on failure. A 409 swaps in the
 * server's latest row so the admin sees what changed.
 */
export function useUpdateProduct() {
  const { scope } = useSignedIn();
  const qc = useQueryClient();
  const key = qk.products(scope);

  return useMutation({
    mutationFn: ({ row, patch }: { row: ProductRow; patch: Patch }) =>
      productsApi.update(row.id, { ...patch, expectedUpdatedAt: row.updatedAt }),
    onMutate: async ({ row, patch }) => {
      await qc.cancelQueries({ queryKey: key });
      const stock = patch.stock !== undefined ? patch.stock : row.stock;
      const optimistic: ProductRow = {
        ...row,
        ...(patch.available !== undefined ? { available: patch.available } : {}),
        stock,
        stockTone: toneFor(stock),
      };
      qc.setQueryData(key, (list: ProductListResponse | undefined) => replaceRow(list, optimistic));
      return { previous: row };
    },
    onError: (e, _vars, ctx) => {
      // Roll back ONLY this product — other rows may hold newer edits.
      const back =
        e instanceof ApiError && e.code === "conflict" && e.details.current
          ? (e.details.current as ProductRow)
          : ctx?.previous;
      if (back) qc.setQueryData(key, (list: ProductListResponse | undefined) => replaceRow(list, back));
    },
    onSuccess: (row) => qc.setQueryData(key, (list: ProductListResponse | undefined) => replaceRow(list, row)),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: key });
      void qc.invalidateQueries({ queryKey: qk.dashboard(scope) });
    },
  });
}
