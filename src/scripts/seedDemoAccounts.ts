/**
 * Seeds one organization and an account for each role, so the platform
 * can be demonstrated without anyone owning a mailbox.
 *
 *   node dist/scripts/seedDemoAccounts.js [--password <value>]
 *
 * These are mock *accounts*, not mock authentication. The passwords are
 * real scrypt hashes checked by the same AuthService as any other login,
 * and the roles are really enforced by OrganizationService — the only
 * shortcut is that nobody had to receive an email. That distinction
 * matters: faking the authentication would hollow out the multi-tenancy
 * it is meant to demonstrate.
 *
 * `email_verified` is set true because it is true: the platform created
 * these addresses, so there is nothing to prove. A real signup will
 * still have to verify before domain-based membership can apply to it.
 *
 * Re-runnable. An account that already exists has its password reset and
 * its role corrected, which is what you want when a demo has been
 * clicked around in. It never touches an account outside the seed list.
 */
import { pool } from "../config/database.js";
import { hashPassword } from "../utils/password.js";
import type { OrganizationRole } from "../models/Organization.js";

const ORGANIZATION_NAME = "RouteRight";
const ORGANIZATION_SLUG = "routeright";
const DOMAIN = "routeright.com";
const PROJECT_NAME = "Checkout";
const PROJECT_SLUG = "checkout";

const DEFAULT_PASSWORD = "routeright-demo";

interface DemoAccount {
    email: string;
    fullName: string;
    role: OrganizationRole;
    /** What this account is for, printed so a demo can follow it. */
    demonstrates: string;
}

const ACCOUNTS: DemoAccount[] = [
    {
        email: `admin@${DOMAIN}`,
        fullName: "Ama Admin",
        role: "ADMIN",
        demonstrates: "manage members and their roles, rename the organization",
    },
    {
        email: `manager@${DOMAIN}`,
        fullName: "Mala Manager",
        role: "MANAGER",
        demonstrates: "create projects, connect repositories, edit business rules",
    },
    {
        email: `developer@${DOMAIN}`,
        fullName: "Dev Developer",
        role: "DEVELOPER",
        demonstrates: "read analyses and rate AI findings — and nothing else",
    },
];

function passwordFromArguments(): string {
    const index = process.argv.indexOf("--password");
    return index !== -1 && process.argv[index + 1] ? process.argv[index + 1] : DEFAULT_PASSWORD;
}

async function seed(): Promise<void> {
    const password = passwordFromArguments();
    const passwordHash = await hashPassword(password);

    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        // One organization, found by slug rather than name so renaming it
        // in the UI does not cause a second one to appear on the next run.
        const organization = await client.query(
            `INSERT INTO organizations (name, slug)
             VALUES ($1, $2)
             ON CONFLICT (slug) DO UPDATE SET updated_at = NOW()
             RETURNING id, name, slug;`,
            [ORGANIZATION_NAME, ORGANIZATION_SLUG]
        );
        const organizationId = organization.rows[0].id;
        console.log(`organization: ${organization.rows[0].name} (${organization.rows[0].slug})`);

        for (const account of ACCOUNTS) {
            const user = await client.query(
                `INSERT INTO users (email, full_name, password_hash, email_verified)
                 VALUES ($1, $2, $3, TRUE)
                 ON CONFLICT (email) DO UPDATE
                     SET full_name      = EXCLUDED.full_name,
                         password_hash  = EXCLUDED.password_hash,
                         email_verified = TRUE,
                         updated_at     = NOW()
                 RETURNING id;`,
                [account.email, account.fullName, passwordHash]
            );

            await client.query(
                `INSERT INTO organization_members (organization_id, user_id, role)
                 VALUES ($1, $2, $3)
                 ON CONFLICT (organization_id, user_id) DO UPDATE SET role = EXCLUDED.role;`,
                [organizationId, user.rows[0].id, account.role]
            );

            console.log(`  ${account.role.padEnd(9)} ${account.email.padEnd(28)} ${account.demonstrates}`);
        }

        // A project to land in, deliberately with no repository: opening it
        // shows the connect page, which is itself the clearest way to see
        // the roles differ — a manager gets the form, a developer is told
        // to ask one.
        await client.query(
            `INSERT INTO projects (organization_id, name, slug)
             VALUES ($1, $2, $3)
             ON CONFLICT (organization_id, slug) DO NOTHING;`,
            [organizationId, PROJECT_NAME, PROJECT_SLUG]
        );
        console.log(`project:      ${PROJECT_NAME} (no repository yet, on purpose)`);

        await client.query("COMMIT");

        console.log(`\npassword for all three: ${password}`);
        console.log("sign in at the platform's login page; each sees the same project differently.");

    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

seed().catch((error) => {
    console.error("seeding failed:", error instanceof Error ? error.message : error);
    process.exit(1);
});
