package main

import (
	"testing"
	"time"
)

func TestNormalizeQuotaMode(t *testing.T) {
	for input, expected := range map[string]string{
		"":         QuotaModeSlots,
		"slots":    QuotaModeSlots,
		"Validade": QuotaModeSlots,
		"credits":  QuotaModeCredit,
		"Credito":  QuotaModeCredit,
	} {
		if got := normalizeQuotaMode(input); got != expected {
			t.Fatalf("normalizeQuotaMode(%q) = %q, want %q", input, got, expected)
		}
	}
}

func TestResellerProvisionCost(t *testing.T) {
	for input, expected := range map[int]int{-10: 1, 0: 1, 1: 1, 3: 3} {
		if got := resellerProvisionCost(input); got != expected {
			t.Fatalf("resellerProvisionCost(%d) = %d, want %d", input, got, expected)
		}
	}
}

func TestListResellerSubtree(t *testing.T) {
	all := []*AdminUser{
		{Username: "root", Role: RoleReseller},
		{Username: "child-a", Role: RoleReseller, ParentUsername: "root"},
		{Username: "child-b", Role: RoleReseller, ParentUsername: "root"},
		{Username: "grandchild", Role: RoleReseller, ParentUsername: "child-a"},
		{Username: "admin", Role: RoleSuperAdmin},
	}
	got := listResellerSubtree(all, "root")
	if len(got) != 4 {
		t.Fatalf("subtree size = %d, want 4", len(got))
	}
	seen := make(map[string]bool)
	for _, user := range got {
		seen[user.Username] = true
	}
	for _, username := range []string{"root", "child-a", "child-b", "grandchild"} {
		if !seen[username] {
			t.Fatalf("subtree does not contain %q", username)
		}
	}
}

func TestResellerCanManageOnlyDirectChildren(t *testing.T) {
	sess := &AdminSession{Username: "parent", Role: RoleReseller}
	if !resellerCanManage(sess, &AdminUser{Username: "child", Role: RoleReseller, ParentUsername: "parent"}) {
		t.Fatal("parent could not manage its direct child")
	}
	if resellerCanManage(sess, &AdminUser{Username: "grandchild", Role: RoleReseller, ParentUsername: "child"}) {
		t.Fatal("parent was allowed to skip a hierarchy level")
	}
	admin := &AdminSession{Username: "admin", Role: RoleSuperAdmin}
	if !resellerCanManage(admin, &AdminUser{Username: "any", Role: RoleReseller}) {
		t.Fatal("superadmin could not manage a reseller")
	}
}

func TestResellerExpiryExtensionDetection(t *testing.T) {
	existing := time.Now().UTC().Add(24 * time.Hour).Truncate(time.Second)
	if resellerExpiryExtended(existing.Format(time.RFC3339), existing.Format(time.RFC3339)) {
		t.Fatal("unchanged expiration was treated as an extension")
	}
	if !resellerExpiryExtended(existing.Format(time.RFC3339), existing.Add(time.Hour).Format(time.RFC3339)) {
		t.Fatal("later expiration was not treated as an extension")
	}
	if resellerTimeExtended(&existing, existing.Add(-time.Hour).Format(time.RFC3339)) {
		t.Fatal("shorter expiration was treated as an extension")
	}
}

func TestRenewalExpiryUsesLaterBase(t *testing.T) {
	future := time.Now().Add(72 * time.Hour)
	got := renewalExpiry(&future, 30)
	want := future.AddDate(0, 0, 30)
	if got.Sub(want) > time.Second || want.Sub(got) > time.Second {
		t.Fatalf("renewal expiry = %s, want %s", got, want)
	}
}

func TestAdminAccountChainUsesPasswordFreeRuntimeState(t *testing.T) {
	parent := "runtime-parent-test"
	child := "runtime-child-test"
	adminUsers.delete(parent)
	adminUsers.delete(child)
	defer resellerRuntimeStates.delete(parent)
	defer resellerRuntimeStates.delete(child)

	resellerRuntimeStates.set(ResellerRuntimeState{OwnerUsername: parent, IsActive: true})
	resellerRuntimeStates.set(ResellerRuntimeState{OwnerUsername: child, ParentUsername: parent, IsActive: true})
	if err := adminAccountChainActive(child); err != nil {
		t.Fatalf("active replicated hierarchy was rejected: %v", err)
	}

	resellerRuntimeStates.set(ResellerRuntimeState{OwnerUsername: parent, IsActive: false})
	if err := adminAccountChainActive(child); err == nil {
		t.Fatal("child remained active while its replicated parent was suspended")
	}
}
