// @flow weak

import React from "react";
import Helmet from "react-helmet";
import TreeSearch from "sourcegraph/tree/TreeSearch";
import Modal from "sourcegraph/components/Modal";
import CSSModules from "react-css-modules";
import styles from "./styles/Repo.css";
import * as RepoActions from "sourcegraph/repo/RepoActions";
import Dispatcher from "sourcegraph/Dispatcher";
import httpStatusCode from "sourcegraph/util/httpStatusCode";
import {trimRepo} from "sourcegraph/repo";
import context from "sourcegraph/app/context";

import Header from "sourcegraph/components/Header";

class RepoMain extends React.Component {
	static propTypes = {
		location: React.PropTypes.object,
		repo: React.PropTypes.string,
		rev: React.PropTypes.string,
		repoResolution: React.PropTypes.object,
		repoObj: React.PropTypes.object,
		main: React.PropTypes.element,
		isCloning: React.PropTypes.bool,
		route: React.PropTypes.object,
		routes: React.PropTypes.array,
	};

	static contextTypes = {
		router: React.PropTypes.object.isRequired,
	};

	constructor(props) {
		super(props);
		this.state = {
			treeSearchActive: false,
			treeSearchPath: "/",
			treeSearchQuery: "",
		};
		this._isMounted = false;
		this._handleKeyDown = this._handleKeyDown.bind(this);
		this._showTreeSearchModal = this._showTreeSearchModal.bind(this);
		this._dismissTreeSearchModal = this._dismissTreeSearchModal.bind(this);

		this._repoResolutionUpdated(this.props.repo, this.props.repoResolution);
	}

	state: {
		treeSearchActive: boolean,
		treeSearchPath: string,
		treeSearchQuery: string,
	};

	componentDidMount() {
		this._isMounted = true;
		if (global.document) {
			document.addEventListener("keydown", this._handleKeyDown);
		}
		// Whenever the user navigates to different RepoMain views, e.g.
		// navigating directories in the directory tree, viewing code
		// files, etc. we trigger a MirroredRepos.RefreshVCS operation such
		// that new changes on the remote are pulled.
		this.context.router.listenBefore(() => Dispatcher.Backends.dispatch(new RepoActions.RefreshVCS(this.props.repo)));
		this.context.router.listenBefore(this._dismissTreeSearchModal);
	}

	componentWillReceiveProps(nextProps) {
		if (this.props.repoResolution !== nextProps.repoResolution) {
			this._repoResolutionUpdated(nextProps.repo, nextProps.repoResolution);
		}
	}

	componentWillUnmount() {
		this._isMounted = false;
		if (global.document) {
			document.removeEventListener("keydown", this._handleKeyDown);
		}
	}

	_repoResolutionUpdated(repo: string, resolution: Object) {
		// Create the repo if we don't have repoObj (the result of creating a repo) yet,
		// and this repo was just resolved to a remote repo (which must be explicitly created,
		// as we do right here).
		if (!this.props.repoObj && repo && resolution && !resolution.Error && resolution.Result.RemoteRepo) {
			// Don't create the repo if user agent is bot.
			if (context.userAgentIsBot) {
				return;
			}

			Dispatcher.Backends.dispatch(new RepoActions.WantCreateRepo(repo, resolution.Result.RemoteRepo));
		}
	}

	_isMounted: boolean;
	_handleKeyDown: () => void;
	_showTreeSearchModal: () => void;
	_dismissTreeSearchModal: () => void;

	_onSelectPath(path: string) {
		this.setState({treeSearchPath: path});
	}

	_onChangeQuery(query: string) {
		this.setState({treeSearchQuery: query});
	}

	_showTreeSearchModal() {
		this.setState({treeSearchActive: true, treeSearchPath: "/", treeSearchQuery: ""});
	}

	_dismissTreeSearchModal() {
		if (!this._isMounted) return;
		this.setState({treeSearchActive: false});
	}

	_handleKeyDown(e: KeyboardEvent) {
		// Consult deepest-matched route (e.g., the "tree" subroute).
		const disableTreeSearchOverlay = this.props.routes[this.props.routes.length - 1].disableTreeSearchOverlay;

		const tag = e.target instanceof HTMLElement ? e.target.tagName : "";
		switch (e.keyCode) {
		case 84: // "t"
			if (disableTreeSearchOverlay) break;
			if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
			e.preventDefault();
			this._showTreeSearchModal();
			break;

		case 27: // ESC
			if (disableTreeSearchOverlay) break;
			this._dismissTreeSearchModal();
		}
	}

	render() {
		const err = (this.props.repoResolution && this.props.repoResolution.Error) || (this.props.repoObj && this.props.repoObj.Error);
		if (err) {
			let msg;
			if (err.response && err.response.status === 401) {
				msg = `Sign in to add repositories.`;
			} else {
				msg = `Repository "${this.props.repo}" is not available.`;
			}
			return (
				<Header
					title={`${httpStatusCode(err)}`}
					subtitle={msg} />
			);
		}

		if (!this.props.repo || !this.props.rev) return null;

		if (this.props.isCloning) {
			return (
				<Header
					title="Cloning this repository"
					subtitle="Refresh this page in a minute." />
			);
		}

		return (
			<div>
				<Helmet title={trimRepo(this.props.repo)} />
				{this.props.main}
				{(!this.props.route || !this.props.route.disableTreeSearchOverlay) && this.state.treeSearchActive &&
					<Modal
						shown={true}
						onDismiss={this._dismissTreeSearchModal}>
						<div styleName="tree-search-modal">
							<TreeSearch
								repo={this.props.repo}
								rev={this.props.rev}
								overlay={true}
								path={this.state.treeSearchPath}
								query={this.state.treeSearchQuery}
								location={this.props.location}
								route={this.props.route}
								onChangeQuery={this._onChangeQuery.bind(this)}
								onSelectPath={this._onSelectPath.bind(this)} />
						</div>
					</Modal>
				}
			</div>
		);
	}
}

export default CSSModules(RepoMain, styles);
