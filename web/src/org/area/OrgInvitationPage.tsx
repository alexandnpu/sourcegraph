import Loader from '@sourcegraph/icons/lib/Loader'
import { upperFirst } from 'lodash'
import * as React from 'react'
import { Link, Redirect } from 'react-router-dom'
import { concat, Observable, Subject, Subscription } from 'rxjs'
import { catchError, concatMap, distinctUntilKeyChanged, map, tap, withLatestFrom } from 'rxjs/operators'
import { orgURL } from '..'
import { refreshCurrentUser } from '../../auth'
import { gql, mutateGraphQL } from '../../backend/graphql'
import * as GQL from '../../backend/graphqlschema'
import { Form } from '../../components/Form'
import { ModalPage } from '../../components/ModalPage'
import { PageTitle } from '../../components/PageTitle'
import { eventLogger } from '../../tracking/eventLogger'
import { userURL } from '../../user'
import { asError, createAggregateError, ErrorLike, isErrorLike } from '../../util/errors'
import { OrgAvatar } from '../OrgAvatar'
import { OrgAreaPageProps } from './OrgArea'

interface Props extends OrgAreaPageProps {
    /** Called when the viewer responds to the invitation. */
    onDidRespondToInvitation: () => void
}

interface State {
    /** The result of accepting the invitation. */
    submissionOrError?: 'loading' | null | ErrorLike

    lastResponse?: boolean
}

/**
 * Displays the organization invitation for the current user, if any.
 */
export class OrgInvitationPage extends React.PureComponent<Props, State> {
    public state: State = {}

    private componentUpdates = new Subject<Props>()
    private responses = new Subject<GQL.OrganizationInvitationResponseType>()
    private subscriptions = new Subscription()

    public componentDidMount(): void {
        eventLogger.logViewEvent('OrgInvitation')

        const orgChanges = this.componentUpdates.pipe(
            distinctUntilKeyChanged('org'),
            map(({ org }) => org)
        )

        this.subscriptions.add(
            this.responses
                .pipe(
                    withLatestFrom(orgChanges),
                    concatMap(([responseType, org]) =>
                        concat(
                            [
                                {
                                    submissionOrError: 'loading',
                                    lastResponse: responseType,
                                },
                            ],
                            this.respondToOrganizationInvitation({
                                organizationInvitation: org.viewerPendingInvitation!.id,
                                responseType,
                            }).pipe(
                                tap(() => eventLogger.log('OrgInvitationRespondedTo')),
                                tap(() => this.props.onDidRespondToInvitation()),
                                concatMap(() => [
                                    // Refresh current user's list of organizations.
                                    refreshCurrentUser(),
                                    { submissionOrError: null },
                                ]),
                                catchError(err => [{ submissionOrError: asError(err) }])
                            )
                        )
                    )
                )
                .subscribe(stateUpdate => this.setState(stateUpdate as State), err => console.error(err))
        )

        this.componentUpdates.next(this.props)
    }

    public componentWillReceiveProps(props: Props): void {
        this.componentUpdates.next(props)
    }

    public componentWillUnmount(): void {
        this.subscriptions.unsubscribe()
    }

    public render(): JSX.Element | null {
        // Redirect unauthenticated users to sign-in.
        if (!this.props.authenticatedUser) {
            const newUrl = new URL(window.location.href)
            newUrl.pathname = '/sign-in'
            // Return to the current page after sign up/in.
            newUrl.searchParams.set('returnTo', window.location.href)
            return <Redirect to={newUrl.pathname + newUrl.search} />
        }

        if (this.state.submissionOrError === null) {
            // Go to organization profile after accepting invitation, or user's own profile after declining
            // invitation.
            return (
                <Redirect
                    to={
                        this.state.lastResponse
                            ? orgURL(this.props.org.name)
                            : userURL(this.props.authenticatedUser.username)
                    }
                />
            )
        }

        return (
            <>
                <PageTitle title={`Invitation - ${this.props.org.name}`} />
                {this.props.org.viewerPendingInvitation ? (
                    <ModalPage icon={<OrgAvatar org={this.props.org.name} className="mt-2 mb-3" size="lg" />}>
                        <Form className="text-center">
                            <h3 className="my-0 font-weight-normal">
                                You've been invited to the{' '}
                                <Link to={orgURL(this.props.org.name)}>
                                    <strong>{this.props.org.name}</strong>
                                </Link>{' '}
                                organization.
                            </h3>
                            <p>
                                <small className="text-muted">
                                    Invited by{' '}
                                    <Link to={userURL(this.props.org.viewerPendingInvitation.sender.username)}>
                                        {this.props.org.viewerPendingInvitation.sender.username}
                                    </Link>
                                </small>
                            </p>
                            <div className="mt-3">
                                <button
                                    type="submit"
                                    className="btn btn-primary mr-sm-2"
                                    disabled={this.state.submissionOrError === 'loading'}
                                    onClick={this.onAcceptInvitation}
                                >
                                    Join {this.props.org.name}
                                </button>
                                <Link className="btn btn-outline-link" to={orgURL(this.props.org.name)}>
                                    Go to {this.props.org.name}'s profile
                                </Link>
                            </div>
                            <div>
                                <button
                                    className="btn btn-link btn-sm"
                                    disabled={this.state.submissionOrError === 'loading'}
                                    onClick={this.onDeclineInvitation}
                                >
                                    Decline invitation
                                </button>
                            </div>
                            {isErrorLike(this.state.submissionOrError) && (
                                <div className="alert alert-danger my-2">
                                    {upperFirst(this.state.submissionOrError.message)}
                                </div>
                            )}
                            {this.state.submissionOrError === 'loading' && <Loader className="icon-inline" />}
                        </Form>
                    </ModalPage>
                ) : (
                    <div className="alert alert-danger">No pending invitation found.</div>
                )}
            </>
        )
    }

    private onAcceptInvitation: React.MouseEventHandler<HTMLButtonElement> = e => {
        e.preventDefault()
        this.responses.next(GQL.OrganizationInvitationResponseType.ACCEPT)
    }

    private onDeclineInvitation: React.MouseEventHandler<HTMLButtonElement> = e => {
        e.preventDefault()
        this.responses.next(GQL.OrganizationInvitationResponseType.REJECT)
    }

    private respondToOrganizationInvitation = (
        args: GQL.IRespondToOrganizationInvitationOnMutationArguments
    ): Observable<void> =>
        mutateGraphQL(
            gql`
                mutation RespondToOrganizationInvitation(
                    $organizationInvitation: ID!
                    $responseType: OrganizationInvitationResponseType!
                ) {
                    respondToOrganizationInvitation(
                        organizationInvitation: $organizationInvitation
                        responseType: $responseType
                    ) {
                        alwaysNil
                    }
                }
            `,
            args
        ).pipe(
            map(({ data, errors }) => {
                if (!data || !data.respondToOrganizationInvitation) {
                    throw createAggregateError(errors)
                }
                return
            })
        )
}