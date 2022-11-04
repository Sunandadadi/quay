from data.database import (
    User,
    FederatedLogin,
    TeamMember,
    Team,
    TeamRole,
    RepositoryPermission,
    Repository,
    Namespace,
    DeletedNamespace,
)
from data.model import (
    user,
    team,
    permission,
    DataModelException,
    InvalidOrganizationException,
    InvalidUsernameException,
    db_transaction,
    _basequery,
)
from endpoints.exception import NotFound


def create_organization(name, email, creating_user, email_required=True, is_possible_abuser=False):
    with db_transaction():
        try:
            # Create the org
            new_org = user.create_user_noverify(
                name, email, email_required=email_required, is_possible_abuser=is_possible_abuser
            )
            new_org.organization = True
            new_org.save()

            # Create a team for the owners
            owners_team = team.create_team("owners", new_org, "admin")

            # Add the user who created the org to the owners team
            team.add_user_to_team(creating_user, owners_team)

            return new_org
        except InvalidUsernameException as iue:
            raise InvalidOrganizationException(str(iue))


def get_organization(name):
    try:
        return User.get(username=name, organization=True)
    except User.DoesNotExist:
        raise InvalidOrganizationException("Organization does not exist: %s" % name)


def convert_user_to_organization(user_obj, admin_user):
    if user_obj.robot:
        raise DataModelException("Cannot convert a robot into an organization")

    with db_transaction():
        # Change the user to an organization and disable this account for login.
        user_obj.organization = True
        user_obj.password_hash = None
        user_obj.save()

        # Clear any federated auth pointing to this user.
        FederatedLogin.delete().where(FederatedLogin.user == user_obj).execute()

        # Delete any user-specific permissions on repositories.
        (RepositoryPermission.delete().where(RepositoryPermission.user == user_obj).execute())

        # Create a team for the owners
        owners_team = team.create_team("owners", user_obj, "admin")

        # Add the user who will admin the org to the owners team
        team.add_user_to_team(admin_user, owners_team)

        return user_obj


def get_user_organizations(username):
    return _basequery.get_user_organizations(username)


# TODO: Simplify this?
def org_view(
    org,
    public_namespaces,
    org_admin_perms,
    create_repo_perms,
    allow_if_superuser,
    avatar,
    user_admin=True,
):
    admin_org = org_admin_perms(org.username)
    org_response = {
        "name": org.username,
        "avatar": avatar.get_data_for_org(org),
        "can_create_repo": create_repo_perms(org.username).can(),
        "public": org.username in public_namespaces,
        "members": fetch_members_of_org(
            org, org_admin_perms, allow_if_superuser, avatar
        ),  # Fetch members of the organization
    }

    if user_admin:
        org_response["is_org_admin"] = admin_org.can()
        org_response["preferred_namespace"] = not (org.stripe_id is None)
    return org_response


def get_paginated_user_organizations(
    username: str,
    page_number: int,
    items_per_page: int,
    public_namespaces: list,
    is_admin: bool,
    org_admin_perms,
    create_repo_perms,
    allow_if_superuser,
    avatar,
):
    organizations = {
        o.username: o
        for o in _basequery.get_paginated_user_organizations(username, page_number, items_per_page)
    }

    if public_namespaces:
        organizations.update({ns: user.get_namespace_user(ns) for ns in public_namespaces})
    return [
        org_view(
            o,
            public_namespaces,
            org_admin_perms,
            create_repo_perms,
            allow_if_superuser,
            avatar,
            user_admin=is_admin,
        )
        for o in list(organizations.values())
    ]


def get_organization_team_members(teamid):
    joined = User.select().join(TeamMember).join(Team)
    query = joined.where(Team.id == teamid)
    return query


def __get_org_admin_users(org):
    return (
        User.select()
        .join(TeamMember)
        .join(Team)
        .join(TeamRole)
        .where(Team.organization == org, TeamRole.name == "admin", User.robot == False)
        .distinct()
    )


def get_admin_users(org):
    """
    Returns the owner users for the organization.
    """
    return __get_org_admin_users(org)


def remove_organization_member(org, user_obj):
    org_admins = [u.username for u in __get_org_admin_users(org)]
    if len(org_admins) == 1 and user_obj.username in org_admins:
        raise DataModelException("Cannot remove user as they are the only organization admin")

    with db_transaction():
        # Find and remove the user from any repositories under the org.
        permissions = list(
            RepositoryPermission.select(RepositoryPermission.id)
            .join(Repository)
            .where(Repository.namespace_user == org, RepositoryPermission.user == user_obj)
        )

        if permissions:
            RepositoryPermission.delete().where(RepositoryPermission.id << permissions).execute()

        # Find and remove the user from any teams under the org.
        members = list(
            TeamMember.select(TeamMember.id)
            .join(Team)
            .where(Team.organization == org, TeamMember.user == user_obj)
        )

        if members:
            TeamMember.delete().where(TeamMember.id << members).execute()


def get_organization_member_set(org, include_robots=False, users_filter=None):
    """
    Returns the set of all member usernames under the given organization, with optional filtering by
    robots and/or by a specific set of User objects.
    """
    Org = User.alias()
    org_users = (
        User.select(User.username)
        .join(TeamMember)
        .join(Team)
        .where(Team.organization == org)
        .distinct()
    )

    if not include_robots:
        org_users = org_users.where(User.robot == False)

    if users_filter is not None:
        ids_list = [u.id for u in users_filter if u is not None]
        if not ids_list:
            return set()

        org_users = org_users.where(User.id << ids_list)

    return {user.username for user in org_users}


def get_all_repo_users_transitive_via_teams(namespace_name, repository_name):
    return (
        User.select()
        .distinct()
        .join(TeamMember)
        .join(Team)
        .join(RepositoryPermission)
        .join(Repository)
        .join(Namespace, on=(Repository.namespace_user == Namespace.id))
        .where(Namespace.username == namespace_name, Repository.name == repository_name)
    )


def get_organizations(disabled=True, deleted=False):
    query = User.select().where(User.organization == True, User.robot == False)

    if not disabled:
        query = query.where(User.enabled == True)
    else:
        # NOTE: Deleted users are already disabled, so we don't need this extra check.
        if not deleted:
            query = query.where(User.id.not_in(DeletedNamespace.select(DeletedNamespace.namespace)))

    return query


def get_active_org_count():
    return get_organizations(disabled=False).count()


def add_user_as_admin(user_obj, org_obj):
    try:
        admin_role = TeamRole.get(name="admin")
        admin_team = (
            Team.select().where(Team.role == admin_role, Team.organization == org_obj).get()
        )
        team.add_user_to_team(user_obj, admin_team)
    except team.UserAlreadyInTeam:
        pass


def fetch_org_member_data(member, avatar):
    # move this check to query!
    if member.user.robot:
        return

    return {
        "name": member.user.username,
        "kind": "user",
        "avatar": avatar.get_data_for_user(member.user),
        "teams": [],
        "repositories": [],
    }


def fetch_members_of_org(orgname, org_admin_perms, allow_if_superuser, avatar):
    org_admin = org_admin_perms(orgname)
    if org_admin.can() or allow_if_superuser():
        try:
            get_organization(orgname)
        except InvalidOrganizationException:
            raise NotFound()

    members_dict = {}
    members = team.list_distinct_organization_members_by_teams(orgname)
    for member in members:
        username = member.user.username
        if username not in members_dict:
            members_dict[username] = fetch_org_member_data(member, avatar)
        members_dict[username]["teams"].append(
            {
                "name": member.team.name,
                "avatar": avatar.get_data_for_team(member.team),
            }
        )

    # Loop to add direct repository permissions.
    for org_perms in permission.list_organization_member_permissions(orgname):
        if username not in members_dict:
            continue
        username = org_perms.user.username
        members_dict[username]["repositories"].append(org_perms.repository.name)

    return list(members_dict.values())
