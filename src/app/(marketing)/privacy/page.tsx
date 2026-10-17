import type { Metadata } from "next";
import Link from "next/link";
import { LegalContact, LegalPage } from "@/components/legal/legal-page";
import { LEGAL_OPERATOR_NAME, LEGAL_UPDATED } from "@/lib/legal";

export const metadata: Metadata = {
  title: "JobFlex · Privacy policy",
  description: "How JobFlex handles personal information, connected Gmail, and your privacy choices.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy policy" number="01" summary="What we collect, how connected services work, and the choices you have about your information." updated={LEGAL_UPDATED.privacy}>
      <p>
        {LEGAL_OPERATOR_NAME}, operating as JobFlex in Washington, United States (&ldquo;we,&rdquo;
        &ldquo;us&rdquo;), provides business software for contractors. This policy covers our website,
        accounts, estimating, proposals, scheduling, communications, and customer and worker portals.
        It applies to visitors, account users, contractors&apos; clients, workers, and people who contact us.
      </p>
      <p>
        We determine how information is used for our own accounts, billing, security, and website
        operations. For client and worker information entered into a contractor&apos;s workspace, we
        generally process information to provide that contractor&apos;s service. The contractor has its
        own privacy obligations and may have a separate privacy notice.
      </p>
      <h2 id="information">1. Information we collect</h2>
      <ul>
        <li><strong>Accounts:</strong> names, email addresses, phone numbers, business and trade details,
          profile information, sign-in credentials or identity-provider identifiers, memberships,
          permissions, and subscription records.</li>
        <li><strong>Business content:</strong> client and worker details, property addresses, estimates,
          proposals, invoices, schedules, assignments, expenses, receipts, photos, messages, support
          requests, reviews, and proposal acceptance and activity records.</li>
        <li><strong>Property and automated tools:</strong> addresses, map coordinates, imagery,
          measurements, project descriptions, and images or documents submitted to enabled estimating,
          photo-analysis, and receipt-reading features, together with their results.</li>
        <li><strong>Payments and integrations:</strong> payment-provider identifiers, transaction amounts
          and status, limited payment-method details, connected-account identifiers, authorization tokens,
          and integration settings. Payment providers collect payment credentials through their interfaces.</li>
        <li><strong>Phone features:</strong> where enabled, caller details, call timing, voicemail
          recordings, transcripts, and associated lead or project records.</li>
        <li><strong>Technical information:</strong> IP addresses, browser and device details, visited pages,
          interactions, referral and campaign information, cookies, and diagnostic and security logs.
          Some information comes from providers and public property sources.</li>
      </ul>
      <h2 id="gmail">2. Your Google and Gmail connection</h2>
      <p>
        Gmail is optional. With your authorization, JobFlex requests <code>gmail.send</code> to send
        email and <code>userinfo.email</code> to identify the connected address. We store that address,
        access and refresh tokens, and token-expiration information. New connection tokens are encrypted
        before storage. We do not receive your Google
        password. This integration does not request permission to read your inbox, import your contacts,
        or delete messages.
      </p>
      <p>
        The Gmail connection is associated with your organization&apos;s workspace. When sending from Gmail
        is enabled, authorized workspace actions and configured workflows can send proposals, invoices,
        reminders, follow-ups, review requests, and other business messages through that account. Workspace
        roles and settings govern who can initiate communications; access is not limited to the person
        who connected Gmail. We transmit recipient addresses, subjects, message content, and sender
        details to Google for delivery.
      </p>
      <p>
        Supported workflows can fall back to JobFlex&apos;s email provider if Gmail is disconnected,
        unavailable, or a send fails. That provider receives the recipient and message content needed
        to deliver the email with the configured reply-to address.
      </p>
      <p>
        We use Gmail authorization information to operate connected email, not for advertising, sale
        to data brokers, credit decisions, or training generalized AI models. Our estimating tools do not
        receive Gmail tokens or retrieve inbox messages. Human
        access is limited to circumstances those policies allow, such as your specific consent,
        security investigations, or legal requirements.
      </p>
      <h3 id="google-data-sharing">Who receives Google user data</h3>
      <p>
        For the Gmail connection, Google user data includes your connected Google email address,
        OAuth access and refresh tokens, and authorization-expiration information. We share, transfer,
        or disclose this information, and the outgoing communications associated with the connection,
        with the following recipients for the purposes described here:
      </p>
      <ul>
        <li><strong>Hosting and database providers:</strong> Vercel and the database hosting services
          used by JobFlex process the connected email address and authorization information on our
          behalf to run and store your Gmail connection. Our application uses tokens on the server;
          new connection tokens are encrypted before database storage.</li>
        <li><strong>Google:</strong> we send authorization tokens to Google to authenticate requests,
          refresh access, and attempt revocation when you disconnect. When a message is sent through
          Gmail, Google receives the sender and recipient addresses, subject, message body, and
          reply-to information needed to deliver it.</li>
        <li><strong>Authorized members of your JobFlex workspace:</strong> members with access to the
          relevant settings can see the connected email address and connection status. Workspace
          permissions govern who can use the connection to initiate messages. Access and refresh
          tokens are not displayed in the workspace interface.</li>
        <li><strong>Your intended email recipients and their email providers:</strong> they receive
          the outgoing message, sender address, and reply-to address as part of email delivery.
          Recipients may retain or forward messages under their own practices.</li>
        <li><strong>Resend or our configured SMTP email provider:</strong> when a supported workflow
          uses platform email, including fallback after a Gmail failure, this provider receives the
          recipient addresses, subject, message content, and configured reply-to address. The reply-to
          address can be your connected Google email address. We do not pass Gmail OAuth access or
          refresh tokens to these email delivery providers.</li>
        <li><strong>Recipients of legally required or security-related disclosures:</strong> we may
          disclose relevant Google user data to authorities or other parties when required by
          applicable law, or when necessary for security purposes such as investigating abuse,
          consistent with Google&apos;s Limited Use requirements.</li>
      </ul>
      <p>
        A transfer of Google user data in a merger, acquisition, or sale of assets requires your
        explicit prior consent under Google&apos;s Limited Use requirements. We do not transfer or
        disclose Gmail connection data for purposes other than the ones described in this section.
        We do not sell this data or share Gmail authorization tokens with advertising networks,
        data brokers, or AI model providers. The general provider list below does not mean that every
        listed provider receives your Gmail connection data.
      </p>
      <p>
        JobFlex&apos;s use and transfer of information received from Google APIs will adhere to the{" "}
        <a href="https://developers.google.com/terms/api-services-user-data-policy">Google API Services User Data Policy</a>,
        including its Limited Use requirements, and the applicable{" "}
        <a href="https://developers.google.com/workspace/workspace-api-user-data-developer-policy">Google Workspace user data policy</a>.
      </p>
      <p>
        A workspace manager can disconnect Gmail in Settings → Integrations → Gmail. This removes
        stored connection tokens and the connected-account label from the active organization record,
        and attempts to revoke the authorization with Google. You can also revoke authorization through your{" "}
        <a href="https://myaccount.google.com/connections">Google Account connections</a>.
        Disconnecting does not delete sent email, proposals, business records, or a separately saved
        reply-to address. Request deletion of retained personal information through <LegalContact />.
        Google and recipients maintain their own copies under their policies.
      </p>
      <h3 id="meta-leads">Meta Page connections and lead imports</h3>
      <p>
        If you connect Meta, JobFlex receives the Facebook user identifier associated with your
        authorization, the Pages you grant access to, their names and identifiers, and Page access
        tokens. We encrypt stored tokens and use them on the server to access the Page you select.
        When an authorized workspace owner or manager clicks Import leads, we retrieve available
        lead-form submissions, including contact details and answers supplied by prospects, and
        create leads in that workspace. We keep import identifiers and progress to avoid duplicate
        imports and allow interrupted imports to resume. Importing does not create ads or automatically
        send messages to prospects.
      </p>
      <p>
        Meta processes authorization and API requests. JobFlex&apos;s hosting and database providers
        process connection information and imported leads on our behalf. Authorized workspace members
        can access imported leads according to their roles; tokens are not shown in the workspace.
        This import does not send lead-form answers to advertising measurement or AI providers.
        Separate features you subsequently use with a lead follow the disclosures in this policy.
        Only connect Pages and import prospect information you are authorized to use.
      </p>
      <p>
        Disconnecting Meta in Settings removes the stored Page connection token and pending import
        progress. To revoke Meta authorization, also remove JobFlex from Facebook Business Integrations.
        Imported leads remain in the workspace until deleted through available controls or an applicable
        deletion request. For deletion of Meta-related personal information, contact <LegalContact />
        with the subject &ldquo;Meta data deletion&rdquo; and identify your workspace and Page; do not send
        passwords or access tokens. Meta retains its own records under its privacy policy.
      </p>
      <h2 id="purposes">3. How we use information</h2>
      <p>
        We use information to provide accounts and workspaces, run requested features, prepare and deliver
        documents and communications, process subscriptions and payments, support users, protect the
        service, investigate abuse, meet legal obligations, and understand and improve usage. Where
        configured, we measure advertising and referrals as described below. Connecting Gmail is not
        permission to send unrelated marketing on your behalf.
      </p>
      <h2 id="sharing">4. Who receives information</h2>
      <ul>
        <li><strong>Workspace members and recipients:</strong> authorized team members, people you send
          documents or messages to, and contractors receiving homeowner requests. Public reviews and
          trade-network posts can expose their content and associated display information to others.</li>
        <li><strong>Hosting and storage:</strong> providers including Vercel and the deployment&apos;s
          database services process content and technical information to operate JobFlex.</li>
        <li><strong>Communications:</strong> Google for connected Gmail, Resend or a configured SMTP
          provider for platform email, and Twilio for enabled SMS, calling, voicemail, and transcription.</li>
        <li><strong>Payments:</strong> Stripe and, where offered or connected, Square, Stax, or PayPal
          process payment and merchant information under their applicable terms and privacy notices.</li>
        <li><strong>Property and AI services:</strong> enabled providers such as Google Maps Platform,
          EagleView, Regrid, ReportAll, OpenAI, and FAL receive the locations, imagery, project text, or
          uploads needed for requested features. Avoid submitting unnecessary personal or sensitive data.</li>
        <li><strong>Analytics and advertising:</strong> PostHog and Meta receive information described
          below when their integrations are configured.</li>
      </ul>
      <p>
        We may disclose information when required by law, to protect people or the service, or for a
        business reorganization or sale subject to applicable protections. The stricter Google-data
        restrictions above continue to apply. Connected providers and contractors may operate as
        independent businesses for their own services; their privacy notices also apply.
      </p>
      <p id="sms">
        <strong>Mobile numbers and text messages:</strong> we use the mobile number you add on
        the Texting page only to send the texts you turned on and to honor STOP and HELP. We do not
        sell, rent, or share mobile numbers or text-message opt-in data with third parties or affiliates
        for their marketing or promotional purposes; Twilio receives them only to deliver our messages.
      </p>
      <h2 id="tracking">5. Cookies, analytics, and advertising</h2>
      <p>
        Essential cookies support sign-in and security. Cookies and browser storage also remember privacy
        choices, promo and referral codes, trade and campaign attribution, drafts, and interface settings.
        Configured durations include 180 days for privacy choices and 30 days for attribution cookies;
        a first-party trial-offer cookie lasts 30 days to keep your offered trial duration consistent across visits and signup. We may compare signup offers, including trial lengths, and record the assigned offer with your signup and subscription. Your exact trial and billing terms are disclosed before enrollment.
        Session and provider cookies have their own lifetimes. Clearing storage may remove preferences
        and require you to sign in again.
      </p>
      <p>
        When configured, PostHog collects page views and interaction information and can record sessions
        on public routes, including public portals. Input fields are masked, but other visible page
        content can appear in replays. Dashboard and other designated private routes are excluded from
        replay. Browser analytics can begin when no stored analytics choice exists; a stored analytics
        opt-out disables browser capture. Separately, server-side operational and feature-usage events
        can include organization identifiers, plan and trade information, feature actions, and diagnostic
        codes. These server events are not controlled by the browser analytics preference.
      </p>
      <p>
        When configured, Meta Pixel uses a saved marketing-enabled choice for advertising events and
        cookie identifiers. Separately, server-side Meta Conversions API events can include registration,
        trial, or purchase information and hashed contact details and identifiers even when browser
        marketing tracking is disabled. Hashing does not make these identifiers anonymous. Additional
        browser identifiers, IP address, and browser details accompany events when the saved marketing
        choice allows them. Later billing events may use the choice saved at registration.
      </p>
      <p>
        We do not sell personal information for money. Disclosures to Meta may count as sale, sharing,
        or targeted advertising under state privacy laws. The footer marketing opt-out affects browser
        tracking but does not by itself stop all server-side disclosures. The cookie-settings panel is
        currently unavailable. Contact <LegalContact /> to request an advertising opt-out, including
        server-side disclosures. Our current implementation does not automatically apply Global Privacy
        Control or Do Not Track signals. These limitations do not remove rights you have under applicable law.
      </p>
      <h2 id="retention">6. Retention, deletion, and security</h2>
      <p>
        Retention depends on the information&apos;s purpose, workspace status and instructions, legal and
        accounting obligations, and security or dispute needs. There is no single automatic deletion
        period for every record. Account deletion does not necessarily remove shared-organization
        records, recipients&apos; copies, processor records, or backups. Organization closure and
        personal-account deletion have different effects; review the confirmation in settings and
        contact us about records that remain.
      </p>
      <p>
        We use access controls and authenticated connections to help protect information, but no system
        is completely secure. Protect your credentials and workspace permissions. We will provide
        security-incident notices when applicable law requires them. JobFlex and its providers may
        process information in the United States and other locations where they operate, with privacy
        laws that differ from your own.
      </p>
      <h2 id="rights">7. Your choices and privacy rights</h2>
      <p>
        You can edit account details, manage workspace permissions, disconnect integrations, and use
        available account-deletion controls. Depending on your residence and applicable law, you may
        have rights to access or know about information, obtain a portable copy, correct inaccuracies,
        request deletion, opt out of sale, sharing, or targeted advertising, and limit certain sensitive
        information uses. We do not use personal information for profiling that produces legal or
        similarly significant decisions about individuals.
      </p>
      <p>
        Send requests to <LegalContact /> with the subject &ldquo;Privacy request.&rdquo; Provide enough
        information to locate the record, without passwords or full payment details. We may verify
        identity and an authorized agent&apos;s authority, except where verification is prohibited for
        opt-outs. We will respond within applicable legal deadlines, explain lawful exceptions, and
        not unlawfully discriminate against you for exercising rights. Where an appeal right applies,
        reply with &ldquo;Privacy appeal&rdquo; for review. You may also contact your state attorney general
        or privacy regulator.
      </p>
      <p>
        For information controlled by a contractor, contact that contractor first; we can help route
        requests to the workspace. A request to us does not automatically remove copies independently
        held by contractors or recipients.
      </p>
      <h2 id="children">8. Children</h2>
      <p>
        JobFlex is intended for adult business users and is not directed to children under 16. We do not
        knowingly collect their personal information. Contact us if you believe a child has provided
        information so we can investigate and address it.
      </p>
      <h2 id="updates">9. Changes and contact</h2>
      <p>
        We update the date on this page when the policy changes and provide notice of material changes
        by email or in the product as appropriate. Where law requires consent for a new use, we will
        request it before that use. Contact <LegalContact /> with questions. See also our{" "}
        <Link href="/terms">Terms of service</Link>.
      </p>
    </LegalPage>
  );
}
