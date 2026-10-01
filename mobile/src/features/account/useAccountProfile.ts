import { Alert } from "react-native";
import { useMutation } from "@tanstack/react-query";
import type { AccountProfileUpdateRequest } from "@contract";
import { meApi } from "@/api/endpoints";
import { useSession } from "@/auth/SessionProvider";
import { PickError, pickImage, type ImageSource } from "@/features/community/hooks/usePickers";

/** Save your own name / nickname (and, for customers, bio); /me reloads so every screen updates. */
export function useSaveAccountProfile() {
  const { reloadMe } = useSession();
  return useMutation({
    mutationFn: (body: AccountProfileUpdateRequest) => meApi.updateProfile(body),
    onSuccess: () => void reloadMe(),
  });
}

/**
 * Change or remove your profile photo. `choose()` asks camera vs library, picks,
 * then uploads; nothing happens if the person cancels.
 */
export function useAccountPhoto() {
  const { reloadMe } = useSession();
  const upload = useMutation({
    mutationFn: async (source: ImageSource) => {
      const draft = await pickImage(source);
      if (!draft) return null;
      return meApi.uploadPhoto({ uri: draft.uri, name: draft.name, type: draft.mimeType });
    },
    onSuccess: (profile) => {
      if (profile) void reloadMe();
    },
    onError: (e) => Alert.alert(e instanceof PickError ? "Can't use that photo" : "Photo not saved", e.message),
  });
  const remove = useMutation({
    mutationFn: () => meApi.removePhoto(),
    onSuccess: () => void reloadMe(),
    onError: (e) => Alert.alert("Photo not removed", e.message),
  });

  function choose() {
    Alert.alert("Profile photo", undefined, [
      { text: "Choose from library", onPress: () => upload.mutate("library") },
      { text: "Take a photo", onPress: () => upload.mutate("camera") },
      { text: "Cancel", style: "cancel" },
    ]);
  }

  function confirmRemove() {
    Alert.alert("Remove photo?", "Your initials will show instead.", [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: () => remove.mutate() },
    ]);
  }

  return { choose, confirmRemove, busy: upload.isPending || remove.isPending };
}
