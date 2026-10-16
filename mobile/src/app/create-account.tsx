import { useRef, useState } from "react";
import { Alert, StyleSheet, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { router } from "expo-router";
import type { SignUpGender } from "@contract";
import { ApiError, type UploadFile } from "@/api/client";
import { meApi } from "@/api/endpoints";
import { useSession } from "@/auth/SessionProvider";
import { AuthField } from "@/features/session/sign-in/AuthField";
import { BackButton, Banner, PrimaryCta, StoreLogo, TextLink, useAuthAccent } from "@/features/session/sign-in/parts";
import { SheetHeading } from "@/features/session/sign-in/StoreSteps";
import { GenderChoice } from "@/features/session/sign-up/GenderChoice";
import { PhotoPicker } from "@/features/session/sign-up/PhotoPicker";
import { AGE_MIN, ageInput, ageTooYoung, PASSWORD_MIN, phoneLooksComplete } from "@/features/session/sign-up/rules";
import { useStoreLink } from "@/store-link/StoreLinkProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { SPACE } from "@/theme/tokens";
import { AppText } from "@/ui/primitives";

/**
 * Create a shopper account — the same account the store's website signs up
 * (POST /auth/register), so it works in both places. Accounts are per store:
 * a phone linked to a store creates it there; otherwise the shopper names the
 * store they buy from. First + last name, mobile number and age are required;
 * gender and a profile photo are optional. Success signs straight in (the root
 * stack then swaps this screen for the app) and the photo uploads with the new
 * session.
 */

const STORE_LOGO_SIZE = 56;

export default function CreateAccount() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { signUp, reloadMe } = useSession();
  const { linked } = useStoreLink();
  const accent = useAuthAccent(!!linked);
  const [store, setStore] = useState("");
  const [photo, setPhoto] = useState<UploadFile | null>(null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [age, setAge] = useState("");
  const [gender, setGender] = useState<SignUpGender | null>(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastNameRef = useRef<TextInput>(null);
  const emailRef = useRef<TextInput>(null);
  const phoneRef = useRef<TextInput>(null);
  const ageRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);

  const storeId = linked ? linked.slug : store.trim();
  const shortPassword = password.length > 0 && password.length < PASSWORD_MIN;
  const tooYoung = ageTooYoung(age);
  const canSubmit =
    !!storeId &&
    !!firstName.trim() &&
    !!lastName.trim() &&
    !!email.trim() &&
    phoneLooksComplete(phone) &&
    !!age &&
    !tooYoung &&
    password.length >= PASSWORD_MIN &&
    !busy;

  const edit = (set: (v: string) => void) => (v: string) => {
    set(v);
    setError(null);
  };

  /** The account already exists by now — a failed photo only costs the photo. */
  async function uploadPhoto(file: UploadFile) {
    try {
      await meApi.uploadPhoto(file);
      await reloadMe();
    } catch (e) {
      const reason = e instanceof ApiError ? ` (${e.message})` : "";
      Alert.alert("Photo not added", `Your account is ready, but your photo didn't upload${reason}. You can add it from your profile.`);
    }
  }

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      await signUp({
        store: storeId,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim(),
        phone: phone.trim(),
        age: Number(age),
        gender,
        password,
      });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong. Please try again.");
      setBusy(false);
      return;
    }
    if (photo) await uploadPhoto(photo);
  }

  // Back to sign-in if it's under this screen, else swap this screen for it —
  // either way the welcome screen stays at the bottom of the stack.
  const toSignIn = () => router.dismissTo("/sign-in");
  const goBack = () => (router.canGoBack() ? router.back() : router.replace("/welcome"));

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.bg }}>
      <StatusBar style={t.scheme === "dark" ? "light" : "dark"} />
      <KeyboardAwareScrollView
        contentContainerStyle={[
          styles.page,
          { paddingTop: insets.top + SPACE.sm, paddingBottom: insets.bottom + SPACE.xl },
        ]}
        keyboardShouldPersistTaps="handled"
        bottomOffset={SPACE.xl}
        showsVerticalScrollIndicator={false}
      >
        <BackButton onPress={goBack} />
        {linked ? (
          <View style={styles.brand}>
            <StoreLogo choice={linked} size={STORE_LOGO_SIZE} />
            <AppText variant="heading" brandFont numberOfLines={1}>
              {linked.name}
            </AppText>
          </View>
        ) : null}

        <SheetHeading
          lead="Create your "
          emphasis="account."
          body={
            linked
              ? `Shop, track your orders and join ${linked.name}'s community. It also works on the store's website.`
              : "Accounts belong to the store you shop at. Enter its name or link, then your details."
          }
          accent={accent}
        />

        <PhotoPicker photo={photo} onChange={setPhoto} accent={accent.link} disabled={busy} />

        <View style={{ gap: SPACE.md }}>
          {linked ? null : (
            <AuthField
              label="Store name or link"
              icon="storefront-outline"
              focusColor={accent.link}
              value={store}
              onChangeText={edit(setStore)}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              returnKeyType="next"
              submitBehavior="submit"
            />
          )}
          <AuthField
            label="First name"
            icon="person-outline"
            focusColor={accent.link}
            value={firstName}
            onChangeText={edit(setFirstName)}
            autoCapitalize="words"
            textContentType="givenName"
            autoComplete="name-given"
            returnKeyType="next"
            submitBehavior="submit"
            onSubmitEditing={() => lastNameRef.current?.focus()}
          />
          <AuthField
            ref={lastNameRef}
            label="Last name"
            icon="person-outline"
            focusColor={accent.link}
            value={lastName}
            onChangeText={edit(setLastName)}
            autoCapitalize="words"
            textContentType="familyName"
            autoComplete="name-family"
            returnKeyType="next"
            submitBehavior="submit"
            onSubmitEditing={() => emailRef.current?.focus()}
          />
          <AuthField
            ref={emailRef}
            label="Email address"
            icon="mail-outline"
            focusColor={accent.link}
            value={email}
            onChangeText={edit(setEmail)}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="username"
            autoComplete="email"
            returnKeyType="next"
            submitBehavior="submit"
            onSubmitEditing={() => phoneRef.current?.focus()}
          />
          <AuthField
            ref={phoneRef}
            label="Mobile number"
            icon="call-outline"
            focusColor={accent.link}
            value={phone}
            onChangeText={edit(setPhone)}
            keyboardType="phone-pad"
            textContentType="telephoneNumber"
            autoComplete="tel"
            returnKeyType="next"
            submitBehavior="submit"
            onSubmitEditing={() => ageRef.current?.focus()}
          />
          <AuthField
            ref={ageRef}
            label="Age"
            icon="calendar-outline"
            focusColor={accent.link}
            invalid={tooYoung}
            value={age}
            onChangeText={(v) => edit(setAge)(ageInput(v))}
            keyboardType="number-pad"
            maxLength={3}
            returnKeyType="next"
            submitBehavior="submit"
            onSubmitEditing={() => passwordRef.current?.focus()}
          />
          {tooYoung ? (
            <AppText variant="caption" color={t.tone("danger").fg}>
              You must be at least {AGE_MIN} to create an account.
            </AppText>
          ) : null}
          <GenderChoice value={gender} onChange={setGender} accent={accent.link} />
          <AuthField
            ref={passwordRef}
            label="Create a password"
            icon="lock-closed-outline"
            focusColor={accent.link}
            invalid={shortPassword}
            value={password}
            onChangeText={edit(setPassword)}
            password
            textContentType="newPassword"
            autoComplete="new-password"
            returnKeyType="go"
            onSubmitEditing={() => void submit()}
          />
          <AppText variant="caption" color={shortPassword ? t.tone("danger").fg : "muted"}>
            At least {PASSWORD_MIN} characters.
          </AppText>
          {error ? <Banner tone="danger" icon="alert-circle" text={error} /> : null}
        </View>

        <PrimaryCta
          label="Create account"
          accent={accent}
          loading={busy}
          disabled={!canSubmit}
          onPress={() => void submit()}
        />

        <View style={styles.links}>
          <TextLink label="Already have an account? Sign in" color={accent.link} onPress={toSignIn} />
        </View>
      </KeyboardAwareScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flexGrow: 1, paddingHorizontal: SPACE.xl, gap: SPACE.xl },
  brand: { alignItems: "center", gap: SPACE.sm },
  links: { alignItems: "center", gap: SPACE.md },
});
