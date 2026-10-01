import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { ChoicePills, EditorSheet, Hint, Section } from "../setup/ui";
import { Field } from "@/ui/inputs";
import { Button } from "@/ui/primitives";
import { SPACE } from "@/theme/tokens";
import { CheckRow } from "./ui";
import { canSaveStaff, type StaffInput, type StaffMember, type StaffModule, type StaffStatus } from "./rules";

/**
 * The website's Add / Edit Staff form (AdminStaffForm) as a page sheet. The
 * permission grid lists only the modules this store exposes; on edit, a blank
 * password keeps the current one. The server's parser decides what's valid —
 * this only mirrors the web's "can press Save" check.
 */
export function StaffEditor({
  staff,
  modules,
  saving,
  onCancel,
  onSave,
}: {
  staff: StaffMember | null;
  modules: readonly StaffModule[];
  saving: boolean;
  onCancel: () => void;
  onSave: (input: StaffInput) => void;
}) {
  const isEdit = !!staff;
  const [fullName, setFullName] = useState(staff?.fullName ?? "");
  const [email, setEmail] = useState(staff?.email ?? "");
  const [username, setUsername] = useState(staff?.username ?? "");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [status, setStatus] = useState<StaffStatus>(staff?.status === "suspended" ? "suspended" : "active");
  const [permissions, setPermissions] = useState<string[]>(staff?.permissions ?? []);

  const input: StaffInput = { fullName, email, username, password, confirmPassword, status, permissions };
  const startPerms = [...(staff?.permissions ?? [])].sort().join(",");
  const dirty =
    fullName !== (staff?.fullName ?? "") ||
    email !== (staff?.email ?? "") ||
    username !== (staff?.username ?? "") ||
    password !== "" ||
    confirmPassword !== "" ||
    status !== (staff?.status === "suspended" ? "suspended" : "active") ||
    [...permissions].sort().join(",") !== startPerms;

  const allOn = modules.length > 0 && modules.every((m) => permissions.includes(m.key));
  const toggle = (key: string) =>
    setPermissions((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  const toggleAll = () => setPermissions(allOn ? [] : modules.map((m) => m.key));

  return (
    <EditorSheet
      visible
      title={isEdit ? "Edit Staff" : "Add Staff"}
      saveLabel={isEdit ? "Save Changes" : "Create Staff"}
      canSave={canSaveStaff(input, isEdit)}
      dirty={dirty}
      saving={saving}
      onCancel={onCancel}
      onSave={() => onSave(input)}
    >
      <Section title="Basic information">
        <Field label="Full Name" value={fullName} onChangeText={setFullName} placeholder="Maria Santos" autoComplete="name" />
        <Field
          label="Email Address"
          value={email}
          onChangeText={setEmail}
          placeholder="maria@example.com"
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
        />
        <Field
          label="Username"
          value={username}
          onChangeText={setUsername}
          placeholder="maria"
          autoCapitalize="none"
          autoCorrect={false}
          hint="Used to sign in. 3–32 characters: lowercase letters, numbers, dot, dash or underscore."
        />
        <Field
          label="Password"
          value={password}
          onChangeText={setPassword}
          password
          autoCapitalize="none"
          autoComplete="new-password"
          placeholder={isEdit ? "Leave blank to keep current password" : "At least 6 characters"}
        />
        <Field
          label="Confirm Password"
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          password
          autoCapitalize="none"
          autoComplete="new-password"
          placeholder="Re-enter password"
        />
        <ChoicePills
          label="Status"
          options={[
            { key: "active", label: "Active" },
            { key: "suspended", label: "Suspended" },
          ]}
          value={status}
          onChange={setStatus}
        />
        <Hint>{"Suspended staff can't sign in."}</Hint>
      </Section>

      <Section
        title="Permissions"
        hint="This staff member will only see the modules you allow. Dashboard, Account Settings and Logout are always available."
      >
        <View style={styles.head}>
          <Button label={allOn ? "Clear all" : "Select all"} variant="secondary" onPress={toggleAll} disabled={modules.length === 0} />
        </View>
        <View style={styles.grid}>
          {modules.map((m) => (
            <CheckRow key={m.key} checked={permissions.includes(m.key)} label={m.label} onPress={() => toggle(m.key)} />
          ))}
        </View>
      </Section>
    </EditorSheet>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", justifyContent: "flex-start" },
  grid: { gap: SPACE.sm },
});
